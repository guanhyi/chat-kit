# chat-kit

> `chat-kit` 是一个专注于 **流式对话控制逻辑 + UI 适配** 的 React/TypeScript 工具包，帮助你在任意项目里快速拥有 DeepSeek 类似的聊天体验。

## 功能亮点
- **网络流层**：`useChatStream` 基于 `rxjs + @ngify/http`，封装 SSE-like 流式消费，提供统一 `StreamEvent` 协议。
- **消息控制层**：`useChatController` 管理 `messages`、`send/cancel/clear/setMessages`，用 `messageLifecycle` 解耦业务状态机。
- **适配器与 UI**：`useDefaultChatAdapter` + `ChatBubbleList` 一步到位，还内置 Markdown、Reasoning Block、工具调用等展示组件。
- **高度可扩展**：消息模型只强制 `question` 字段，其他 `files/aiAssistantId/...` 通过 `extra` 透传，跨项目复用零负担。

## 在其他项目中安装（Git 子包方案）
`chat-kit` 暂不发布到 npm，最佳实践是把它作为 Git 子模块拉进业务仓库，再通过 workspace/file 依赖引用。

### 1. 引入子模块
```bash
cd <your-app-repo>
git submodule add http://gitlab.ihuizheng.cn/web-developer/chat-kit.git packages/chat-kit
git submodule update --init --recursive
```

> 建议放到 `packages/chat-kit`，便于和其他内部包保持统一结构。

### 2. 让包管理器识别
- **pnpm**：在 `pnpm-workspace.yaml` 中加入 `packages/chat-kit`，然后执行 `pnpm install`。在应用 `package.json` 中写：
  ```json
  {
      "dependencies": {
          "chat-kit": "workspace:*"
      }
  }
  ```
- **npm/yarn**：使用 `file:` 语法指向相对路径：
  ```json
  {
      "dependencies": {
          "chat-kit": "file:packages/chat-kit"
      }
  }
  ```

### 3. 在业务代码中引用
```ts
import { useChatController, ChatBubbleList } from 'chat-kit'
```
因为是本地包，TypeScript/构建链路会自动走到子模块源码，可直接与主项目共享 `react/rxjs` 等依赖。

### 4. 后续维护
- 更新到最新实现：
  ```bash
  cd packages/chat-kit
  git pull origin main
  ```
- 若业务仓库需要锁定特定版本，可在子模块里打 tag，并在 `git submodule` 中指定 tag/commit。

## 快速上手
1. **准备 HTTP 客户端**：包装现有 `useHttp()` 或任意 `HttpClient`，让它符合 `HttpClientLike` 接口。
2. **定义请求构造器**：在 `buildRequest` 中拼装 API、body、headers，把业务字段放在 `extra`。
3. **选择控制方式**：
   - 只需要 Hook：直接使用 `useChatController`，自定义 `messageLifecycle`。
   - 想要开箱即用 UI：使用 `useDefaultChatAdapter`，再把 `listProps` 丢给 `ChatBubbleList`。
4. **在组件里发送消息**：通过 `send({ question, extra })` 或 `sendMessage(question, extra)` 发起流式对话。

```tsx
import {
    useDefaultChatAdapter,
    ChatBubbleList,
    type BaseMessage
} from 'chat-kit'

const roles = {
    user: ({ message }: { message: BaseMessage }) => <UserBubble text={message.content} />,
    ai: ({ message }: { message: BaseMessage }) => <AiBubble blocks={message.blocks} />,
    loading: () => <LoadingBubble />
}

export function ChatView() {
    const adapter = useDefaultChatAdapter({
        roles,
        httpClient,
        buildRequest: ({ question, extra }) => ({
            api: '/api/chat',
            body: { query: question, ...extra },
            headers: { 'Content-Type': 'application/json' }
        }),
        initialMessages: [
            { id: 'start', role: 'start', content: '欢迎使用 chat-kit' }
        ]
    })

    return (
        <>
            <ChatBubbleList {...adapter.listProps} />
            <InputBox
                loading={adapter.controller.loading}
                onSend={(text, payload) => adapter.sendMessage(text, payload)}
            />
        </>
    )
}
```

## 典型场景
- **多项目复用**：把 `chat-kit` 设为统一的对话 SDK，不再拷贝聊天逻辑。
- **块级推理展示**：使用 `ui/blocks/*` 组件渲染思考、工具调用、引用文档。
- **自定义协议**：通过自定义 `parseEvent` 与 `messageLifecycle` 对接任意流式协议。

## 延伸阅读
- 详细的架构设计、约束、类型定义请参考 `docs/chat-kit-design.md`（即旧版 README 的完整内容）。
- Playground 示例位于 `src/playground`，可以直接运行 `pnpm dev` 体验 UI 行为。

---

需要了解更深入的 Hook 签名或二次开发建议？请先阅读 `docs/chat-kit-design.md`，再根据自身业务扩展 `messageLifecycle`、UI 模板或更细粒度的事件处理。
