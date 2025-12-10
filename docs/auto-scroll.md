# 自动滚动技术实现说明

> 适用范围：`packages/chat-kit` 中的 `ChatBubbleList` 与 `useAutoScroll`。本文聚焦于自动滚动的设计目标、实现细节、典型使用方式以及可扩展点，便于在其它项目或自定义列表中复用同样的体验。

## 1. 背景与目标

聊天/文档类界面往往有「边生成边展示」的流式内容，同时又要允许用户随时回看历史。自动滚动模块需要同时满足以下场景：

- **流式贴底**：在模型推理、Markdown 逐字补全、图片懒加载等不停修改 DOM 的情况下，视图必须自然跟随底部且不能抖动。
- **用户控制权**：用户手动滚动离开底部时，系统不应强行拉回；只有用户重新到达底部才恢复跟随。
- **可复用**：逻辑不依赖具体 UI 库，可与 OverlayScrollbars、虚拟列表 (`VList`) 或任意容器组合，并提供 `scrollToBottom` 等 API。
- **性能可控**：监听事件要足够轻量，避免 MutationObserver 无限触发或滚动事件导致 Layout Thrashing。

## 2. 设计总览

整体结构分为两层：

1. **UI 容器 (`ChatBubbleList`)**
   - 负责渲染虚拟列表、配置 OverlayScrollbars 的 viewport、安全底部 (`safeBottom`) 等。
   - 通过 `useAutoScroll` 获得跟随控制器，并把 `scrollToBottom` 暴露给外部。
2. **滚动控制器 (`useAutoScroll`)**
   - 输入：`getViewport`（用于访问实际可滚动的元素）+ 预留配置（`threshold`）。
   - 输出：`attach/detach`、`scrollToBottom`、`maybeFollow`、`follow` 状态等接口。
   - 内部由事件监听 + MutationObserver + requestAnimationFrame/queueMicrotask 协同完成。

这种解耦方式让我们可以在别的项目照搬 `useAutoScroll`，而 `ChatBubbleList` 只负责「把 viewport 暴露出去并在合适的时机 attach」。

## 3. `useAutoScroll` 实现细节

### 3.1 状态变量

| 变量 | 作用 |
| --- | --- |
| `followRef` / `follow` | 是否处于「跟随模式」。`followRef` 供内部同步读取，`follow` 用于触发 React 更新（可供外部 UI 显示“回到底部”按钮）。 |
| `programmaticRef` | 标记当前是否由代码触发滚动（例如调用 `scrollToBottom`），以免被误判为用户操作。 |
| `userInteractingRef` + `userInteractTimeoutRef` | 记录最近 250ms 内是否出现用户输入（wheel/touch/pointer/键盘）。只要为 `true`，`scroll` 事件导致的离底就被视作用户行为。 |
| `moRef` | 统一管理 MutationObserver 的实例，`attach`/`detach`/组件卸载时都会 disconnect。 |
| `followTaskPendingRef` | 避免 MutationObserver 在同一批 DOM 变动中重复触发 `maybeFollow`。 |

### 3.2 事件监听策略

1. **交互事件（wheel / touchstart / pointerdown / keydown）**
   - 这些事件都会调用 `markUserInteracting()`，并在 250ms 后自动清除，保证一次操作导致的多个滚动事件仍然归类为“同一波用户操作”。
   - keydown 仅监听会引发滚动的按键（`Arrow*`、`Page*`、`Home`、`End`、`Space`）。

2. **滚动事件**
   - 每次 `scroll` 会计算 `distance = scrollHeight - scrollTop - clientHeight`。
   - 条件判断：
     - `distance <= 2px`：视为真正回到底部，立即 `updateFollow(true)`。
     - `distance > 2px` 且 `userInteractingRef` 为真：说明用户主动离底，`updateFollow(false)`。
     - 其余情况（如虚拟列表重排导致的瞬时离底）不做处理，以免误杀。
   - 如果当前正处于 `programmaticRef` 状态（例如 `scrollToBottom` 刚执行），直接跳过，避免代码驱动的滚动反复关闭跟随。

3. **MutationObserver**
   - 监听 `subtree/childList/attributes/characterData`，以覆盖消息块更新、Markdown 解析、图片尺寸变化等情况。
   - 仅在 `followRef.current === true` 时才继续，以免浪费资源。
   - 使用 `queueMicrotask`（退化到 `Promise.resolve().then` 或 `setTimeout`）来调度 `maybeFollow()`，确保 DOM 更新和滚动校正在同一帧完成，避免“先掉一行再被拉回”的视觉抖动。
   - `followTaskPendingRef` 用于防止短时间内重复调度，microtask 执行完才会重置该标记。

### 3.3 核心 API

```ts
const ctrl = useAutoScroll(getViewport, undefined, { threshold: 0.99 })

ctrl.attach()        // 注册事件与 Observer，返回的函数用于 detach
ctrl.scrollToBottom('smooth') // 主动滚动到底部
ctrl.maybeFollow()   // 仅在 followRef 为 true 时自动滚动
ctrl.setFollow(false) // 外部手动切换模式
```

`scrollToBottom` 会把 `'instant'` 视为 `behavior: 'auto'`，其余值行保持 `ScrollBehavior` 原意。内部通过 `requestAnimationFrame` 在下一帧清除 `programmaticRef`。

### 3.4 生命周期

1. 组件初始化时创建 `useAutoScroll`，但尚未监听任何事件。
2. `ChatBubbleList` 检测到 `autoScroll` 为 true 后调用 `ctrl.attach()`；返回的清理函数会在组件卸载或依赖变化时执行。
3. MutationObserver + 滚动事件共同维护 `follow` 状态。
4. 当消息数量增加时，`ChatBubbleList` 会调用 `ctrl.maybeFollow()` —— 仅当 follow 模式下才真正滚动，避免纯状态更新时强制贴底。

## 4. 与 `ChatBubbleList` 的协作

### 4.1 OverlayScrollbars + VList

`ChatBubbleList` 使用 OverlayScrollbars 包裹虚拟列表：

1. 外层 `div`（`rootRef`）作为 OverlayScrollbars 的 `target`。
2. `VList` 容器作为 `viewport`，可让 OverlayScrollbars 直接管理虚拟滚动区域。
3. `getViewport` 函数优先返回 OverlayScrollbars 的 viewport（若实例存在），否则退回到 `rootRef.current`。

这样既能享受定制滚动条，又不会破坏虚拟列表对 DOM 的管理。`safeBottom` 则通过在 `VList` 尾部渲染一个指定高度的元素，避免输入框遮挡最后一条消息。

### 4.2 典型的接入代码

```tsx
const [initialize, instance] = useOverlayScrollbars({ /* ... */ })
const autoScrollCtrl = useAutoScroll(
    () => instance()?.elements().viewport || rootRef.current,
    undefined,
    { threshold: 0.99 }
)

useEffect(() => {
    if (!autoScroll) return
    return autoScrollCtrl.attach()
}, [autoScroll, autoScrollCtrl])

const prevLenRef = useRef(messages.length)
useEffect(() => {
    if (!autoScroll) {
        prevLenRef.current = messages.length
        return
    }
    const prev = prevLenRef.current
    prevLenRef.current = messages.length
    if (messages.length > prev) autoScrollCtrl.maybeFollow()
}, [messages.length, autoScroll, autoScrollCtrl])
```

外部可通过 `ref` 获取 `scrollToBottom` 与 `nativeElement`，例如：

```ts
bubbleListRef.current?.scrollToBottom('smooth')
```

## 5. 自定义容器示例

如果项目不使用 `ChatBubbleList`，也可以直接复用 Hook：

```tsx
const viewportRef = useRef<HTMLDivElement | null>(null)
const autoScroll = useAutoScroll(() => viewportRef.current)

useEffect(() => autoScroll.attach(), [autoScroll])

return (
    <>
        <div ref={viewportRef} className="chat-log">
            {messages.map(renderMessage)}
        </div>
        <button onClick={() => autoScroll.scrollToBottom('smooth')}>回到底部</button>
    </>
)
```

关键只在于：提供一个稳定的可滚动容器引用，其它逻辑无需重写。

## 6. 常见问题与调试

| 现象 | 可能原因 | 对策 |
| --- | --- | --- |
| 流式渲染时列表“忽快忽慢” | DOM 变动被合并过度或 `minDelay` 过大 | 调整 `useSmoothMarkdownStream` 的节流参数，但无需改自动滚动。 |
| 用户滚动时仍被强制拉回 | 未正确标记用户交互或 `scroll` 事件在 `programmaticRef` 期间触发 | 确认 `attach` 时包含了 wheel/touch/pointer/keydown 监听，且不要手动修改 `programmaticRef`。 |
| 使用自定义容器后无法贴底 | `getViewport` 返回 `null` 或 DOM 在渲染中被频繁替换 | 确保容器在 `attach` 前已渲染完成，或在 ref 改变后重新 `attach`。 |
| **Firefox 无法打断自动滚动** | 在 Firefox + OverlayScrollbars 中，`getViewport` 初始阶段会返回外层容器（不可滚动），其 `scrollTop` 永远为 0，导致 Hook 判定用户始终处于「贴底」状态。Chrome 会把 `wheel` 事件冒泡到真实 viewport，所以问题不明显。 | `useAutoScroll` 内部通过 `syncViewport` 持续检查 `getViewport` 返回值，一旦 OverlayScrollbars 初始化完成就重新绑定监听，确保所有事件、MutationObserver 都落在真正的 viewport 上；若未来 DOM 再次替换，也会自动重新 attach。 |

## 7. 扩展点

- **自定义阈值**：目前 `threshold` 预留为数值配置，未来可扩展为“离底 X px 内仍算跟随”的策略。
- **与消息锚点联动**：可以结合 IntersectionObserver（非必需）在 follow 关闭时高亮当前阅读位置。
- **SSR/多窗口兼容**：Hook 默认依赖 `window`，如需 SSR，可在外部检测 `typeof window !== 'undefined'` 后再初始化。

---

通过以上分层和机制，我们在流式 Markdown、虚拟列表、OverlayScrollbars 的复杂组合下依然保持稳定的自动滚动体验，并且用户可自由滚动而不被打扰。只要在新的项目中沿用 `getViewport + attach` 的接入方式，就能快速复用这套能力。*** End Patch
