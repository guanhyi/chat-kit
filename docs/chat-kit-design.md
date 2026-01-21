# chat-kit 设计与使用文档

> 本包名称：`chat-kit`  
> 作用：作为对话核心逻辑包的总说明文档，后续在其它项目/对话中都可以直接参考这一份。

---

## 1. 包定位与设计约束

### 1.1 包定位

`chat-kit` 是一个「对话核心逻辑」包，提供：

- 基础能力：
  - 基于 `rxjs + @ngify/http` 风格的流式请求处理（SSE-like）。
  - 可配置的流式事件协议（思考、正文、工具、引用等）。
- 状态管理：
  - 管理 `messages`（消息列表），对外暴露 `send / cancel / clear / setMessages`。
  - 内置一个可定制的消息生命周期机制，让调用方控制消息结构和状态机。
- UI 与适配层：
  - 内置一套基础 UI 封装（如 `ChatBubbleList` + 自动滚动），方便快速搭建完整对话界面。
  - 内置一套「类 useZhiXingChatNext」的默认适配器，复用当前项目行为作为模板，供其他项目直接使用或二次定制。
- 扩展性：
  - 不绑定任何业务字段（如 `aiAssistantId`、`chatId`、`areaCode`、`files` 等），全部视为「额外字段」。
  - 可用于多个不同项目，只要满足网络层使用 `rxjs + @ngify/http` 风格即可。

### 1.2 强约束

1. **对其它子包零依赖**
   - 禁止从当前 monorepo 的 `packages/*`、`apps/*` 引用任何模块。
   - 只能依赖公开的第三方库（例如：`react`、`rxjs`、`@ngify/http` 类型等）。

2. **禁止使用 `fetch`**
   - 网络层只能基于 `rxjs` + `@ngify/http` 的事件流模式（`HttpEventType.DownloadProgress` 等）。
   - 用一个抽象的 `HttpClientLike` 接口，让调用方把自己的 HTTP 客户端（例如当前项目的 `useHttp()` 返回值）适配进来。

3. **对话数据结构高度可定制**
   - 核心模型只认一个字段：`question`。
   - `files`、`aiAssistantId`、`chatId`、`areaCode`、任意业务字段，全部通过 `extra` 透传，不在核心 API 顶层出现。
   - 本包负责维护 `messages`，但不写死「send 时 push USER + LOADING」等逻辑，只提供「生命周期回调 + `setMessages`」让调用方决定。

4. **React Hook 形态 + UI 封装**
   - 导出核心 Hook：`useChatStream`、`useChatController`，以及默认适配器 Hook（如 `useDefaultChatAdapter`）。
   - 同时导出基础 UI 组件（如 `ChatBubbleList`），但调用方可以选择只用 Hook 自己写 UI。

---

## 2. 整体架构

从下到上分为三层：

1. **网络流层（Network Stream Layer）**
   - Hook：`useChatStream`
   - 负责：
     - 使用注入的 `httpClient` 发起流式请求（`observe: 'events'`，`HttpEventType.DownloadProgress`）。
     - 把下载进度中的文本流解析为规范的事件（`StreamEvent`：text / thinking / tool / citation 等）。
     - 管理 `loading` / `cancel` 等基础状态。
   - 不关心 `messages`，不操作 UI。

2. **消息控制层（Message Controller Layer）**
   - Hook：`useChatController`
   - 负责：
     - 管理 `messages: TMessage[]`。
     - 暴露 `send / cancel / clear / setMessages`。
     - 提供可配置的 `messageLifecycle`，给调用方插入逻辑：
       - `onBeforeSend`：send 前如何 push USER/LOADING/其它。
       - `onStreamEvent`：收到流式事件后如何更新最后一条/某条消息的 `blocks/docs/...`。
       - `onCancel`：取消时如何修改最后一条消息。
       - `onClear`：清空时如何保留首条 START 等。
   - 核心思想：**我们维护列表，你决定具体怎么改**。

3. **UI 层 + 适配层**
   - UI 层：在本包内提供基础组件（例如 `ChatBubbleList` + 自动滚动），让调用方可以开箱即用搭出对话界面，是本包的**核心组成部分**。
   - 适配层：提供默认适配器（如 `useDefaultChatAdapter`），内部基于 `useChatController` 预置一套「USER + LOADING + 块流式」行为，复现当前项目的对话体验，同样是本次工作的**必备内容**。
   - 调用方可以：
     - 直接用默认适配器 + UI 组件，快速接入「请求 + 状态管理 + 列表渲染」的一整套能力；
     - 或只用底层 Hook，自行实现自己的适配器与 UI。

---

## 3. 核心类型与协议

这一节只定义类型形状，不涉及具体实现。

### 3.1 基础消息类型

```ts
/** 最基础的消息结构，调用方可以扩展 */
export interface BaseMessage {
    id: string
    role: string          // 如 'user' | 'ai' | 'system' | 'loading' 等
    content?: string
    createdAt?: number
    updatedAt?: number
    [key: string]: any    // 任意业务字段，如 files/docs/blocks/answer/query/...
}
```

调用方可以通过范型 `TMessage extends BaseMessage` 扩展自己的字段。

### 3.2 发送参数类型

```ts
/** 发送对话的公共输入：只约束 question，其他全部放在 extra */
export type ChatSendInput<TExtra = any> = {
    question: string      // 唯一必需字段
    extra?: TExtra        // 任意额外数据：files/aiAssistantId/chatId/areaCode/...
}
```

- `question`：内部用于构造请求、驱动流式处理。
- `extra`：
  - 完整透传给：
    - `buildRequest({ question, extra })` → 构造 HTTP 请求。
    - `messageLifecycle` 中的回调（`onBeforeSend/onStreamEvent`），便于你根据这些字段更新消息。

### 3.3 HTTP 客户端抽象（基于 rxjs + @ngify/http）

```ts
import type { Observable } from 'rxjs'
import type { HttpEvent } from '@ngify/http' // 实际按项目需要引入
import { HttpEventType } from '@ngify/http'

/** 与当前项目 HttpClient 兼容的最小接口 */
export interface HttpClientLike {
    post: (
        url: string,
        body: any,
        options: {
            observe: 'events'
            responseType: 'text'
            reportProgress: true
            headers?: Record<string, string>
        }
    ) => Observable<HttpEvent<any>>
}
```

说明：

- 本包**不会**实现具体 HTTP 请求，只使用这个接口。
- 调用方可使用自己的 HTTP 客户端（如当前项目的 `useHttp()` 返回的实例）包装成 `HttpClientLike` 再传入。

### 3.4 流式事件类型（StreamEvent）

为了将服务端数据流转换为可理解的事件流，我们定义统一但可扩展的 `StreamEvent` 结构。

核心思想：**`chat-kit` 不写死有哪些事件类型，只约定基本形状，具体事件种类由调用方或适配器约定。**

```ts
/**
 * 通用流式事件：type 是任意字符串，payload 由调用方自定义。
 * - raw   保留服务端原始 JSON，便于 debug 与向下兼容；
 * - meta  可选元信息（如请求 id、chunk 索引等）。
 */
export interface StreamEvent<
    TType extends string = string,
    TPayload = any,
    TMeta = any
> {
    type: TType
    payload: TPayload
    raw: any
    timestamp: number
    meta?: TMeta
}
```

说明：

- `type`：
  - 只是一个标识字符串（例如 `'text-delta'`、`'thinking-start'`、`'tool-log'` 等），本包不做枚举限制。
  - 默认适配器会约定一套常用的 type 值，但你完全可以新增自己的类型。
- `payload`：
  - 承载该事件的业务数据（例如 `delta`、`docs`、`toolName` 等），由调用方和后端协议一起约定。
- `meta`：
  - 用于承载一些通用元信息（例如块 id、消息 id、流 id），方便在 `messageLifecycle` 中使用。

建议：在自己的项目中可以定义更严格的别名，例如：

```ts
type ChatStreamEvent = StreamEvent<
    | 'text-start'
    | 'text-delta'
    | 'text-complete'
    | 'thinking-start'
    | 'thinking-delta'
    | 'thinking-complete'
    | 'tool-pending'
    | 'tool-in-progress'
    | 'tool-complete'
    | 'citation-update'
    | 'block-complete'
    | 'error'
    | 'done',
    any
>
```

这样既可以复用默认适配器中约定的行为，又可以在未来轻松扩展更多事件类型，而不需要改动 `chat-kit` 本身。

---

## 4. useChatStream：网络流 Hook

### 4.1 设计目标

- 封装「如何发起流式请求并解析 SSE-like 文本流」。
- 只负责网络与事件，不管理 `messages`。
- 返回统一的 `StreamEvent` 事件流给上层处理。

### 4.2 类型定义

```ts
export interface UseChatStreamOptions<TExtra = any> {
    httpClient: HttpClientLike

    /** 构造请求：URL、body、headers 等全部由调用方决定 */
    buildRequest: (input: { question: string; extra?: TExtra }) => {
        api: string
        body?: any
        headers?: Record<string, string>
    }

    /** 是否为最终事件：结合后端协议决定。可选，不传则使用默认逻辑 */
    isFinal?: (rawEvent: any) => boolean

    /** 解析服务端 JSON，转换为 StreamEvent；默认实现可参考当前 SSE 协议 */
    parseEvent?: (rawData: any) => StreamEvent[]

    /** 生命周期回调（可选） */
    onOpen?: (body: any) => void
    onError?: (err: any) => void
    onComplete?: () => void
}

export interface UseChatStreamResult<TExtra = any> {
    /** 触发一次新的对话请求（创建新的流） */
    start: (input: ChatSendInput<TExtra>) => import('rxjs').Subscription

    /** 取消当前流 */
    cancel: () => void

    /** 当前是否存在进行中的流 */
    loading: boolean
}
```

### 4.3 行为说明（伪流程）

1. 调用 `start({ question, extra })`：
   - 调用 `options.buildRequest({ question, extra })` 得到 `{ api, body, headers }`。
   - 使用 `httpClient.post(api, body, { observe: 'events', ... })` 发起请求。
2. 监听 `HttpEventType.DownloadProgress`：
   - 从 `partialText` 中提取增量内容。
   - 按 SSE 协议规则累计缓冲并切分事件。
   - 对每个事件体调用 `options.parseEvent`，得到一个或多个 `StreamEvent`。
   - 把这些 `StreamEvent` 上报给上层（在 `useChatController` 中消费）。
3. 监听 `HttpEventType.Response`：
   - 若之前未收到任何 `DownloadProgress` 事件，则兜底解析一次完整 body。
4. 根据 `options.isFinal` 判断是否结束：
   - 一旦 `isFinal(event)` 为真，停止解析、标记 `loading = false` 并调用 `onComplete`。

### 4.4 使用示例（伪代码）

```ts
const stream = useChatStream({
    httpClient,
    buildRequest: ({ question, extra }) => ({
        api: '/api/ai/deepseek_chat/chat',
        body: {
            query: question,
            // 统一把业务字段放在 extra 中
            ...extra,
        },
        headers: {
            'Content-Type': 'application/json',
        },
    }),
    parseEvent: (raw) => {
        // raw 是后端 data 字段解析后的 JSON，按协议转换成 StreamEvent[]
        return translateServerJsonToStreamEvents(raw)
    },
})

const onSend = () => {
    stream.start({
        question: input,
        extra: { aiAssistantId, chatId, areaCode: '331101', files },
    })
}
```

---

## 5. useChatController：消息控制 Hook

### 5.1 设计目标

- 基于 `useChatStream` 维护 `messages` 列表。
- 暴露统一控制接口：
  - `send / cancel / clear / setMessages`。
- 不写死消息结构和状态机，通过 `messageLifecycle` 让调用方控制。

### 5.2 类型定义

```ts
export interface MessageLifecycle<TMessage extends BaseMessage = BaseMessage, TExtra = any> {
    /**
     * send 调用时，在真正发起网络请求前执行。
     * 你可以在这里往 draft 里 push USER/LOADING 等消息。
     */
    onBeforeSend?: (
        draft: TMessage[],
        ctx: { question: string; extra?: TExtra }
    ) => void

    /**
     * 每当有一个或多个 StreamEvent 到达时调用。
     * 你可以在这里更新最后一条 AI 消息的 blocks/docs/answer/thinking 等。
     */
    onStreamEvent?: (
        draft: TMessage[],
        event: StreamEvent,
        ctx: { question: string; extra?: TExtra }
    ) => void

    /**
     * cancel 时调用：例如，把最后一条消息改成 isEnd=true、loading=false 等。
     */
    onCancel?: (draft: TMessage[]) => void

    /**
     * clear 时调用：你可以决定保留哪些系统消息，比如 START 欢迎语。
     */
    onClear?: (draft: TMessage[]) => void
}

export interface UseChatControllerOptions<
    TMessage extends BaseMessage = BaseMessage,
    TExtra = any
> extends UseChatStreamOptions<TExtra> {
    initialMessages?: TMessage[]

    /** 自定义消息生命周期；不传则使用内置默认实现 */
    messageLifecycle?: MessageLifecycle<TMessage, TExtra>
}

export interface UseChatControllerResult<
    TMessage extends BaseMessage = BaseMessage,
    TExtra = any
> {
    messages: TMessage[]
    loading: boolean

    /**
     * 发送问题：内部会依次调用 messageLifecycle.onBeforeSend 和 useChatStream.start
     */
    send: (input: ChatSendInput<TExtra>) => import('rxjs').Subscription

    /** 取消当前流：会调用 messageLifecycle.onCancel 并中断网络 */
    cancel: () => void

    /** 清空对话：会调用 messageLifecycle.onClear 更新 messages */
    clear: () => void

    /**
     * 暴露底层 setMessages：在任何时刻你可以手动修改最后一条或任意消息。
     * 类似 useImmer 的写法：setMessages((draft) => { ... })
     */
    setMessages: (updater: (draft: TMessage[]) => void) => void
}
```

### 5.3 默认行为（推荐实现思路）

虽然 Hook 本身不写死具体逻辑，但本包可以提供一个「默认生命周期实现」，大致对齐当前项目中的行为（仅作为示例，在实现文件里可以导出）：

- `defaultMessageLifecycle` 示例思路：
  - `onBeforeSend`：
    - push 一条 `role: 'user'` 的消息。
    - push 一条 `role: 'loading'` 的消息（占位等待 AI 回复）。
  - `onStreamEvent`：
    - 按 `event.type` 找到最后一条 `role: 'loading'`/`'ai'` 消息，更新其 `blocks/docs/answer/thinking/process` 等字段。
  - `onCancel`：
    - 修改最后一条消息为 `isEnd = true`、`loading = false`、`isThinking = false` 等。
  - `onClear`：
    - 保留首条 `role: 'start'` 欢迎消息，其余清空。

当前项目可以直接引用这个默认实现，也可以复制后按需调整。

### 5.4 使用示例（简化版）

```ts
// 1) 在当前项目中定义自己的 Message 类型
interface ChatMessage extends BaseMessage {
    answer?: string
    docs?: any[]
    isEnd?: boolean
    isThinking?: boolean
    fileList?: any[]
    blocks?: any[]
}

// 2) 在组件中使用 useChatController
const {
    messages,
    loading,
    send,
    cancel,
    clear,
    setMessages,
} = useChatController<ChatMessage, { aiAssistantId?: string; chatId?: string; fileList?: any[] }>({
    httpClient,
    buildRequest: ({ question, extra }) => ({
        api: extra?.aiAssistantId
            ? '/api/ai/deepseek_chat/chat_with_assistant'
            : '/api/ai/deepseek_chat/chat',
        body: {
            query: question,
            ...(extra || {}),
        },
    }),
    initialMessages: [
        {
            id: 'start',
            role: 'start',
            content: '欢迎使用 AI 对话',
        },
    ],
    messageLifecycle: myLifecycle, // 或 defaultMessageLifecycle
})

// 3) sendMessage 完全由你控制 extra
const sendMessage = (message: string, fileList: any[]) => {
    send({
        question: message,
        extra: {
            aiAssistantId,
            chatId,
            fileList,
            areaCode: '331101',
        },
    })
}
```

---

## 6. 建议的目录结构

在 `packages/chat-kit` 中建议结构如下：

```text
packages/chat-kit/
  ├─ src/
  │   ├─ types.ts                 # BaseMessage/ChatSendInput/StreamEvent/... 类型
  │   ├─ stream/
  │   │   ├─ useChatStream.ts     # 网络流 Hook，实现 SSE-like 解析
  │   │   └─ parser.ts            # 文本流解析工具（可参考 HttpEventSource 实现）
  │   ├─ controller/
  │   │   └─ useChatController.ts # 消息控制 Hook + 默认 messageLifecycle
  │   ├─ adapter/
  │   │   └─ useDefaultChatAdapter.ts # 默认适配器：基于 useChatController 复现标准对话行为
  │   ├─ ui/
  │   │   ├─ ChatBubbleList.tsx   # 基础对话气泡列表组件，内置自动滚动
  │   │   └─ useAutoScroll.ts     # 自动滚动 Hook（IO+MO+事件），供 ChatBubbleList 复用
  │   └─ index.ts                 # 对外导出
  └─ README.md                    # 本文档
```

UI 组件与默认适配器是 `chat-kit` 的内建能力，不是后续扩展。

---

## 7. UI 组件与默认适配器

这一节说明本包提供的基础 UI 组件 `ChatBubbleList` 以及默认适配器 `useDefaultChatAdapter` 的职责与 API。

### 7.1 ChatBubbleList 概览

- 职责：
  - 把一串 `messages: TMessage[]` 渲染为聊天气泡列表。
  - 通过 `roles` 决定不同 `role` 的消息如何渲染（类似当前项目的 `roles: RolesType`）。
  - 内置自动滚动逻辑（基于 IO + MO + 事件），在「跟随模式」下保持视图贴底，并在用户手动滚动时停止跟随。
- 依赖：
  - `react`（函数组件 + ref）。
  - 不依赖当前项目的 `components` 包，内部实现自己的列表与滚动逻辑。

### 7.2 ChatBubbleList 类型（草案）

```ts
export interface ChatBubbleListRef {
    /** 滚动到底部，behavior 支持 'auto' | 'smooth' | 'instant' */
    scrollToBottom: (behavior?: ScrollBehavior | 'instant') => void
    /** 底层可滚动容器，便于做额外操作（可选） */
    nativeElement?: HTMLElement | null
}

export interface RoleRenderProps<TMessage> {
    message: TMessage
    index: number
}

/** 不同 role 对应的渲染函数映射 */
export type RolesMap<TMessage> = Record<
    string,
    (props: RoleRenderProps<TMessage>) => React.ReactNode
>

export interface ChatBubbleListProps<
    TMessage extends BaseMessage = BaseMessage
> {
    /** 消息列表，由 useChatController 或适配器提供 */
    messages: TMessage[]

    /** 角色映射：例如 { user: renderUserBubble, ai: renderAIBubble, system: renderSystemBubble } */
    roles: RolesMap<TMessage>

    /** 是否自动跟随底部（默认 true） */
    autoScroll?: boolean

    /** 安全底部距离，避免输入框遮挡（默认可为 0） */
    safeBottom?: number

    /** 外层样式与类名 */
    className?: string
    style?: React.CSSProperties

    /**
     * 容器插槽：可以在列表前后插入自定义内容（如欢迎语、底部哨兵之外的区域等）。
     * 默认：直接渲染 children。
     */
    container?: (children: React.ReactNode) => React.ReactNode
}
```

行为约定：

- 当 `messages` 变化时，如果当前处于「跟随模式」，`ChatBubbleList` 会自动滚动到底部；
- 用户主动滚动离开底部时，自动关闭跟随；当用户再次滚到列表底部时，恢复跟随；
- 可以通过 ref 调用 `scrollToBottom('instant')` 等方式手动控制滚动。

### 7.3 默认适配器：useDefaultChatAdapter

`useDefaultChatAdapter` 是基于 `useChatController` 封装的一层「现成可用」适配器，用于快速接入完整对话体验：

- 内部职责：
  - 使用 `useChatController` 管理 `messages` 与 `send/cancel/clear/setMessages`。
  - 使用默认的 `messageLifecycle`，在 `send` 时自动 push USER + LOADING 等消息，并在流式事件到来时更新块/引用等字段。
  - 提供适配好的 `ChatBubbleListProps`，方便直接挂到组件上。
- 对外 API（草案）：

```ts
export interface UseDefaultChatAdapterResult<
    TMessage extends BaseMessage = BaseMessage,
    TExtra = any
> {
    /** 用于渲染列表的 props，直接传给 <ChatBubbleList /> */
    listProps: ChatBubbleListProps<TMessage>

    /** 控制层：来自 useChatController 的完整返回值 */
    controller: UseChatControllerResult<TMessage, TExtra>

    /**
     * 语义化的发送函数：等价于 controller.send，但可以根据默认生命周期封装常用逻辑。
     * 例如 sendMessage(question, extra)。
     */
    sendMessage: (question: string, extra?: TExtra) => import('rxjs').Subscription
}
```

典型用法（伪代码）：

```tsx
const {
    listProps,
    controller,
    sendMessage,
} = useDefaultChatAdapter<MyMessage, MyExtra>({
    httpClient,
    buildRequest,
    initialMessages,
    messageLifecycle, // 可选：不传则使用内置默认实现
    roles: myRoles,
})

return (
    <>
        <ChatBubbleList {...listProps} />
        <MyInput
            loading={controller.loading}
            onSend={(q, extra) => sendMessage(q, extra)}
        />
    </>
)
```

注意：

- 默认适配器只是一个「现成模板」，你依然可以直接使用 `useChatController` + `ChatBubbleList` 自己写完全不同的行为；
- 默认适配器内部不会写死业务字段（如 `aiAssistantId`），全部通过 `extra` 透传给 `buildRequest` 与 `messageLifecycle`。

---

## 8. 在当前项目中的接入思路（参考）

这一节仅用于说明如何在现有 `ChatView` 中使用 `chat-kit`，不属于核心包的一部分实现。

### 7.1 网络适配

在当前项目中使用 `useHttp()` 时：

```ts
const http = useHttp()

const httpClient: HttpClientLike = {
    post: (url, body, options) => http.post(url, body, options),
}
```

然后将 `httpClient` 传给 `useChatStream` / `useChatController`。

### 7.2 消息结构适配

可定义本项目自己的 `ChatMessage` 与 `messageLifecycle`，尽量复用现有 `BubbleDataType` 的字段，使迁移成本较低。

---

## 9. 后续扩展方向（可选）

1. **更多 UI 皮肤与布局**
   - 在现有 `ChatBubbleList` 基础上，增加不同风格的主题与布局（如多栏布局、对话卡片模式等）。

2. **更多预置适配器**
   - 在当前默认适配器之外，提供适配不同协议/不同块模型的适配器（例如只需要纯文本、不需要块/引用的轻量版）。

3. **严格类型化 StreamEvent**
   - 根据后端协议不断细化 `StreamEvent` 的字段，提供更强的 TS 类型提示。

---

这份文档是 `chat-kit` 的整体设计说明，后续在不同项目里只要满足：

- 有一个符合 `HttpClientLike` 的 HTTP 客户端；
- 能处理 `rxjs` 的 Subscription；
- 自己定义 `TMessage` 与 `messageLifecycle`；

就可以快速复用同一套对话流式控制逻辑。
