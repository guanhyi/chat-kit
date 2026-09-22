import type { Observable } from 'rxjs'
import type { HttpEvent } from '@ngify/http'
import type React from 'react'
import type { VListHandle } from 'virtua'

/** 最基础的消息结构，调用方可以扩展 */
export interface BaseMessage {
    id?: string
    role: string
    content?: string
    createdAt?: number
    updatedAt?: number
    // 允许挂载任意业务字段：files/docs/blocks/answer/query/...
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
}

// ===================== Block 风格消息 =====================

export type BlockStatus = 'streaming' | 'success' | 'error'

/**
 * 标准 Block 结构：
 * - type 允许自由扩展，但约定常见类型为：
 *   - mainText：正文
 *   - thinking：思考过程
 *   - tool：工具调用
 *   - citation：引用文档
 */
export interface Block {
    id: string
    type: string
    status: BlockStatus
    content?: string
    toolName?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    docs?: any[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meta?: any
    createdAt: number
    updatedAt: number
}

/**
 * Block 风格消息：在 BaseMessage 基础上补充块结构与若干兼容字段
 */
export interface BlockMessage extends BaseMessage {
    blocks?: Block[]
    answer?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    docs?: any[]
    isThinking?: boolean
    think?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process?: any[]
    isEnd?: boolean
}

/** 发送对话的公共输入：只约束 question，其他全部放在 extra */
export type ChatSendInput<TExtra = any> = {
    question: string
    extra?: TExtra
}

/** 与外部 HttpClient 兼容的最小接口（基于 rxjs + @ngify/http 风格） */
export interface HttpClientLike {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    post: (
        url: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: any,
        options: {
            observe: 'events'
            responseType: 'text'
            reportProgress: true
            headers?: Record<string, string>
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) => Observable<HttpEvent<any>>
}

/**
 * 通用流式事件：type 是任意字符串，payload 由调用方自定义。
 * - raw   保留服务端原始 JSON，便于 debug 与向下兼容；
 * - meta  可选元信息（如请求 id、chunk 索引等）。
 */
export interface StreamEvent<TType extends string = string, TPayload = any, TMeta = any> {
    type: TType
    payload: TPayload
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    raw: any
    timestamp: number
    meta?: TMeta
}

/**
 * 原始流事件通知：每条合法 JSON SSE 都会触发，供应用层消费协议元信息。
 * 不进入 messageLifecycle，也不默认修改 messages。
 */
export interface RawStreamEvent<TExtra = any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    raw: any
    question: string
    extra?: TExtra
    timestamp: number
}

export interface UseChatStreamOptions<TExtra = any> {
    httpClient: HttpClientLike

    /** 构造请求：URL、body、headers 等全部由调用方决定 */
    buildRequest: (input: { question: string; extra?: TExtra }) => {
        api: string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body?: any
        headers?: Record<string, string>
    }

    /** 是否为最终事件：结合后端协议决定。可选，不传则使用默认逻辑 */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    isFinal?: (rawEvent: any) => boolean

    /** 解析服务端 JSON，转换为 StreamEvent；默认实现可参考当前 SSE 协议 */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parseEvent?: (rawData: any) => StreamEvent[]

    /** 每条合法 JSON SSE 的旁路通知；不影响 parseEvent 与 messages 生命周期 */
    onRawEvent?: (event: RawStreamEvent<TExtra>) => void

    /** 生命周期回调（可选） */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onOpen?: (body: any) => void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export interface MessageLifecycle<TMessage extends BaseMessage = BaseMessage, TExtra = any> {
    /**
     * send 调用时，在真正发起网络请求前执行。
     * 你可以在这里往 draft 里 push USER/LOADING 等消息。
     */
    onBeforeSend?: (
        draft: TMessage[],
        ctx: {
            question: string
            extra?: TExtra
        }
    ) => void

    /**
     * 每当有一个或多个 StreamEvent 到达时调用。
     * 你可以在这里更新最后一条 AI 消息的 blocks/docs/answer/thinking 等。
     */
    onStreamEvent?: (
        draft: TMessage[],
        event: StreamEvent,
        ctx: {
            question: string
            extra?: TExtra
        }
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

export interface UseChatControllerOptions<TMessage extends BaseMessage = BaseMessage, TExtra = any>
    extends UseChatStreamOptions<TExtra> {
    initialMessages?: TMessage[]

    /** 自定义消息生命周期；不传则使用内置默认实现 */
    messageLifecycle?: MessageLifecycle<TMessage, TExtra>
}

export interface UseChatControllerResult<TMessage extends BaseMessage = BaseMessage, TExtra = any> {
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
     * 约定使用 immer 风格：setMessages((draft) => { ... })
     */
    setMessages: (updater: (draft: TMessage[]) => void) => void
}

export interface ChatBubbleListRef {
    scrollToBottom: (behavior?: ScrollBehavior | 'instant') => void
    /** 当前滚动视口（可能是 OverlayScrollbars viewport / VList 根节点） */
    nativeElement?: HTMLElement | null
    /** 实时取滚动视口，避免 imperative handle 初始化时拿到 null */
    getViewport?: () => HTMLElement | null
    vListRef?: React.RefObject<VListHandle | null>
}

export interface RoleRenderProps<TMessage> {
    message: TMessage
    index: number
}

export interface RoleConfig<TMessage> {
    /** 左右位置：start 左侧，end 右侧；不传默认为 start */
    placement?: 'start' | 'end'
    render: (props: RoleRenderProps<TMessage>) => React.ReactNode
}

export type RolesMap<TMessage> = Record<string, RoleConfig<TMessage>>

export interface ChatBubbleListProps<TMessage extends BaseMessage = BaseMessage> {
    messages: TMessage[]
    roles: RolesMap<TMessage>
    autoScroll?: boolean
    safeBottom?: number
    scrollbarVisible?: boolean
    className?: string
    bubbleClassName?: string
    style?: React.CSSProperties
    container?: (children: React.ReactNode) => React.ReactNode
    /**
     * 列表滚动回调（来自底层 VList）。
     * 注意：scroll 事件本身不冒泡，需要通过该回调或监听 viewport 才能可靠感知滚动。
     */
    onScroll?: (offset: number) => void
    /**
     * 跟随态变化回调：用户上滚离底时为 false，回到底部（或调用 scrollToBottom）后为 true。
     * 可用来显示「回到底部」按钮。
     */
    onFollowChange?: (following: boolean) => void
}

export interface UseDefaultChatAdapterOptions<
    TMessage extends BaseMessage = BaseMessage,
    TExtra = any
> extends UseChatControllerOptions<TMessage, TExtra> {
    roles: RolesMap<TMessage>
}

export interface UseDefaultChatAdapterResult<
    TMessage extends BaseMessage = BaseMessage,
    TExtra = any
> {
    listProps: ChatBubbleListProps<TMessage>
    controller: UseChatControllerResult<TMessage, TExtra>
    sendMessage: (question: string, extra?: TExtra) => import('rxjs').Subscription
}

// ===================== BlocksChat 适配器 =====================

/**
 * Block 风格适配器的配置：
 * - 继承 UseChatStreamOptions（httpClient + buildRequest）
 * - 默认内部会使用块生命周期，不需要调用方自己传 messageLifecycle/parseEvent
 */
export interface UseBlocksChatAdapterOptions<TExtra = any> extends UseChatStreamOptions<TExtra> {
    initialMessages?: BlockMessage[]
    roles: RolesMap<BlockMessage>
    /** 若为 true，则适配器不在 onBeforeSend 中插入 user/ai 消息，交由外部自行维护 */
    useExternalMessages?: boolean
}

export interface UseBlocksChatAdapterResult<TExtra = any> {
    listProps: ChatBubbleListProps<BlockMessage>
    controller: UseChatControllerResult<BlockMessage, TExtra>
    sendMessage: (question: string, extra?: TExtra) => import('rxjs').Subscription
}
