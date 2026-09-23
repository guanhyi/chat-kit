import { produce } from 'immer'
import type {
    BaseMessage,
    ChatSendInput,
    ChatSendOptions,
    ChatStreamHandle,
    MessageLifecycle,
    MessagePhase,
    StreamContext,
    StreamEndReason,
    StreamEvent,
    StreamOutcome,
    UseChatControllerOptions
} from '../types'
import { openChatStream, type ChatStreamConnection } from '../stream/openChatStream'
import { defaultIsFinal, defaultParseEvent } from '../stream/useChatStream'
import { setMessagePhase } from './messagePhase'

export interface ChatSessionState<TMessage extends BaseMessage = BaseMessage> {
    messages: TMessage[]
    /** 是否有进行中的请求 */
    loading: boolean
    /** 正在写入的消息 id */
    activeMessageId: string | null
}

export type ChatSessionOptions<TMessage extends BaseMessage = BaseMessage, TExtra = any> = Omit<
    UseChatControllerOptions<TMessage, TExtra>,
    'initialMessages' | 'sessionKey'
>

interface ActiveStream<TExtra> {
    ctx: StreamContext<TExtra>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parse: (raw: any) => StreamEvent[]
    connection: ChatStreamConnection | null
    receivedContent: boolean
    finished: boolean
}

interface QueuedEvent<TExtra> {
    ctx: StreamContext<TExtra>
    event: StreamEvent
}

/** 请求的开始/结束。用来在会话之外（会话列表、通知、关闭确认）感知进行中的对话 */
export type ChatSessionLifecycleEvent =
    | { type: 'start'; messageId: string }
    | { type: 'settle'; messageId: string; outcome: StreamOutcome }

/** 后台标签页不跑 rAF，用定时器兜底，避免切回来之前内容一直不更新 */
const FLUSH_FALLBACK_MS = 50

let messageIdSeq = 0

/** 生成消息 id。外部插入占位消息时用它，再通过 send 的 messageId 指定写入目标 */
export const createMessageId = (): string =>
    `msg-${Date.now().toString(36)}-${(messageIdSeq++).toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 6)}`

export function defaultFormatError(outcome: StreamOutcome): string {
    if (outcome.reason === 'timeout') return '响应超时，请稍后再试'
    if (outcome.reason === 'closed') return '没有收到回复，请稍后再试'
    return '哎呀，出错了，请稍后再试'
}

/** 请求结束原因 → 消息最终阶段 */
export function resolveOutcomePhase(
    reason: StreamEndReason,
    receivedContent: boolean
): StreamOutcome['phase'] {
    if (reason === 'final') return 'done'
    if (reason === 'closed') return receivedContent ? 'done' : 'error'
    if (reason === 'cancelled') return 'cancelled'
    return 'error'
}

const findMessage = <TMessage extends BaseMessage>(draft: TMessage[], id: string) =>
    draft.find((message) => message.id === id)

/**
 * 一个会话的消息与进行中请求。放在 React 之外：
 * - 流式事件按消息 id 写入，不再默认写「最后一条」，流式期间插入别的消息也不会写错；
 * - 同一帧收到的事件攒起来一次提交，只触发一次重渲染；
 * - 每次请求恰好收尾一次：完成、没收到最终帧就断开、出错、超时、取消都走 finish；
 * - 组件卸载不影响它，配合 chatSessionRegistry 可以在回到页面时接上进行中的请求。
 */
export class ChatSessionStore<TMessage extends BaseMessage = BaseMessage, TExtra = any> {
    private state: ChatSessionState<TMessage>
    private readonly listeners = new Set<() => void>()
    private readonly idleListeners = new Set<() => void>()
    private readonly lifecycleListeners = new Set<(event: ChatSessionLifecycleEvent) => void>()
    private active: ActiveStream<TExtra> | null = null
    private queue: QueuedEvent<TExtra>[] = []
    private flushHandle: { raf: number | null; timer: ReturnType<typeof setTimeout> } | null = null

    constructor(
        private options: ChatSessionOptions<TMessage, TExtra>,
        initialMessages: TMessage[] = []
    ) {
        this.state = { messages: initialMessages, loading: false, activeMessageId: null }
    }

    /** 每次渲染更新为最新的配置（buildRequest、回调等闭包） */
    setOptions(options: ChatSessionOptions<TMessage, TExtra>) {
        this.options = options
    }

    getState = (): ChatSessionState<TMessage> => this.state

    subscribe = (listener: () => void) => {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    get isStreaming(): boolean {
        return this.active !== null
    }

    /**
     * 订阅请求的开始与结束。与 subscribe 不同，它不随流式增量触发，
     * 适合给会话列表、站内通知这类「只关心有没有在生成」的地方用。
     */
    onLifecycle(listener: (event: ChatSessionLifecycleEvent) => void) {
        this.lifecycleListeners.add(listener)
        return () => {
            this.lifecycleListeners.delete(listener)
        }
    }

    /** 当前请求结束时通知一次 */
    onceIdle(listener: () => void) {
        if (!this.active) {
            listener()
            return
        }
        this.idleListeners.add(listener)
    }

    setMessages = (updater: (draft: TMessage[]) => void) => {
        const next = produce(this.state.messages, (draft) => {
            updater(draft as TMessage[])
        })
        if (next !== this.state.messages) this.setState({ messages: next })
    }

    send = (input: ChatSendInput<TExtra>, sendOptions: ChatSendOptions = {}): ChatStreamHandle => {
        if (this.active) this.cancel()

        const lifecycle = this.lifecycle
        const ctx: StreamContext<TExtra> = {
            question: input.question,
            extra: input.extra,
            messageId: sendOptions.messageId ?? createMessageId()
        }

        this.setMessages((draft) => {
            lifecycle.onBeforeSend?.(draft, ctx)
            let target = findMessage(draft, ctx.messageId)
            if (!target && !sendOptions.messageId) {
                // 外部自己插了占位消息但没给 id：写入当前最后一条，并补上 id
                const last = draft[draft.length - 1]
                if (last) {
                    if (last.id) ctx.messageId = last.id
                    else last.id = ctx.messageId
                    target = last
                }
            }
            if (target) setMessagePhase(target, 'pending')
        })

        const active: ActiveStream<TExtra> = {
            ctx,
            parse: lifecycle.createParser?.() ?? this.options.parseEvent ?? defaultParseEvent,
            connection: null,
            receivedContent: false,
            finished: false
        }
        this.active = active
        this.setState({ loading: true, activeMessageId: ctx.messageId })
        this.emitLifecycle({ type: 'start', messageId: ctx.messageId })

        try {
            const request = this.options.buildRequest({ question: ctx.question, extra: ctx.extra })
            this.options.onOpen?.({ question: ctx.question, extra: ctx.extra })
            active.connection = openChatStream({
                httpClient: this.options.httpClient,
                request,
                isFinal: (raw) => (this.options.isFinal || defaultIsFinal)(raw),
                idleTimeoutMs: this.options.idleTimeoutMs,
                onData: (raws) => this.receive(active, raws),
                onEnd: ({ reason, error }) => this.finish(active, reason, error)
            })
        } catch (error) {
            this.finish(active, 'error', error)
        }

        return {
            unsubscribe: () => {
                if (this.active === active) this.cancel()
            }
        }
    }

    cancel = () => {
        const active = this.active
        if (!active) return
        if (active.connection) active.connection.cancel()
        else this.finish(active, 'cancelled')
    }

    clear = () => {
        const lifecycle = this.lifecycle
        if (lifecycle.onClear) {
            this.setMessages((draft) => lifecycle.onClear?.(draft))
        } else {
            this.setMessages((draft) => {
                draft.length = 0
            })
        }
    }

    /** 立即提交已攒下的流式事件 */
    flush = () => {
        if (this.flushHandle) {
            if (this.flushHandle.raf !== null && typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(this.flushHandle.raf)
            }
            clearTimeout(this.flushHandle.timer)
            this.flushHandle = null
        }
        if (this.queue.length === 0) return
        const batch = this.queue
        this.queue = []
        const lifecycle = this.lifecycle
        this.setMessages((draft) => {
            for (const { ctx, event } of batch) {
                const target = findMessage(draft, ctx.messageId)
                // 目标消息已被移除（例如清空对话）：按 no-op 处理
                if (!target) continue
                if (target.phase === 'pending') setMessagePhase(target, 'streaming')
                lifecycle.onStreamEvent?.(draft, event, ctx)
            }
        })
    }

    dispose() {
        if (this.flushHandle) {
            if (this.flushHandle.raf !== null && typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(this.flushHandle.raf)
            }
            clearTimeout(this.flushHandle.timer)
            this.flushHandle = null
        }
        this.listeners.clear()
        this.idleListeners.clear()
        this.lifecycleListeners.clear()
    }

    private emitLifecycle(event: ChatSessionLifecycleEvent) {
        for (const listener of [...this.lifecycleListeners]) listener(event)
    }

    private get lifecycle(): MessageLifecycle<TMessage, TExtra> {
        return this.options.messageLifecycle ?? {}
    }

    private setState(partial: Partial<ChatSessionState<TMessage>>) {
        this.state = { ...this.state, ...partial }
        for (const listener of this.listeners) listener()
    }

    private receive(active: ActiveStream<TExtra>, raws: unknown[]) {
        if (this.active !== active) return
        const { question, extra } = active.ctx
        for (const raw of raws) {
            this.options.onRawEvent?.({ raw, question, extra, timestamp: Date.now() })
            for (const event of active.parse(raw)) {
                this.queue.push({ ctx: active.ctx, event })
                active.receivedContent = true
            }
        }
        this.scheduleFlush()
    }

    private scheduleFlush() {
        if (this.flushHandle || this.queue.length === 0) return
        const raf =
            typeof requestAnimationFrame === 'function' ? requestAnimationFrame(this.flush) : null
        this.flushHandle = { raf, timer: setTimeout(this.flush, FLUSH_FALLBACK_MS) }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private finish(active: ActiveStream<TExtra>, reason: StreamEndReason, error?: any) {
        if (active.finished) return
        active.finished = true
        // 结束前收到的内容先落地，再收尾
        this.flush()

        const phase: MessagePhase = resolveOutcomePhase(reason, active.receivedContent)
        const outcome: StreamOutcome = {
            phase: phase as StreamOutcome['phase'],
            reason,
            error,
            receivedContent: active.receivedContent
        }
        const errorText =
            phase === 'error' ? (this.options.formatError ?? defaultFormatError)(outcome) : undefined
        const lifecycle = this.lifecycle

        this.setMessages((draft) => {
            lifecycle.onFinalize?.(draft, outcome, active.ctx)
            if (phase === 'cancelled' && !lifecycle.onFinalize) lifecycle.onCancel?.(draft)
            const target = findMessage(draft, active.ctx.messageId)
            if (!target) return
            setMessagePhase(target, phase)
            if (errorText) target.errorText = errorText
            target.updatedAt = Date.now()
        })

        const wasCurrent = this.active === active
        if (wasCurrent) {
            this.active = null
            this.setState({ loading: false, activeMessageId: null })
            this.emitLifecycle({ type: 'settle', messageId: active.ctx.messageId, outcome })
        }

        if (outcome.phase === 'done') this.options.onComplete?.()
        else if (outcome.phase === 'error') {
            this.options.onError?.(error ?? new Error(`chat stream ended: ${reason}`))
        }

        if (!this.active) {
            const listeners = [...this.idleListeners]
            this.idleListeners.clear()
            for (const listener of listeners) listener()
        }
    }
}

// ===================== 按 key 管理的会话 =====================

interface SessionEntry {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store: ChatSessionStore<any, any>
    leases: number
    /** 解绑 onLifecycle */
    detach: () => void
}

const sessions = new Map<string, SessionEntry>()

/** 会话结束的通知：谁、结果如何 */
export interface ChatSessionSettledEvent {
    key: string
    messageId: string
    outcome: StreamOutcome
}

const activeKeys = new Set<string>()
/** useSyncExternalStore 要求快照引用稳定，只在集合真变了时换一份 */
let activeKeysSnapshot: string[] = []
const activeListeners = new Set<() => void>()
const settledListeners = new Set<(event: ChatSessionSettledEvent) => void>()

function publishActiveKeys() {
    activeKeysSnapshot = [...activeKeys]
    for (const listener of [...activeListeners]) listener()
}

function attachSession(key: string, store: ChatSessionStore<any, any>) {
    const detach = store.onLifecycle((event) => {
        if (event.type === 'start') {
            if (activeKeys.has(key)) return
            activeKeys.add(key)
            publishActiveKeys()
            return
        }
        if (activeKeys.delete(key)) publishActiveKeys()
        const settled: ChatSessionSettledEvent = {
            key,
            messageId: event.messageId,
            outcome: event.outcome
        }
        for (const listener of [...settledListeners]) listener(settled)
    })
    if (store.isStreaming && !activeKeys.has(key)) {
        activeKeys.add(key)
        publishActiveKeys()
    }
    return detach
}

function forgetSession(key: string, entry: SessionEntry) {
    entry.detach()
    if (activeKeys.delete(key)) publishActiveKeys()
}

/** 当前正在生成的会话 key（就是 useChatController 的 sessionKey）。引用稳定 */
export function getActiveChatSessionKeys(): string[] {
    return activeKeysSnapshot
}

export function isChatSessionStreaming(key: string): boolean {
    return activeKeys.has(key)
}

/** 订阅「哪些会话在生成」的变化 */
export function subscribeActiveChatSessions(listener: () => void): () => void {
    activeListeners.add(listener)
    return () => {
        activeListeners.delete(listener)
    }
}

/** 订阅会话结束事件。用于非当前会话完成时的站内通知 */
export function subscribeChatSessionSettled(
    listener: (event: ChatSessionSettledEvent) => void
): () => void {
    settledListeners.add(listener)
    return () => {
        settledListeners.delete(listener)
    }
}

/**
 * 取出 key 对应的会话；不存在就用 create 新建并登记。
 * restored 为 true 表示接上了已有会话（仍在生成，或还有别的视图在用）。
 */
export function acquireChatSession<TMessage extends BaseMessage, TExtra>(
    key: string,
    create: () => ChatSessionStore<TMessage, TExtra>
): { store: ChatSessionStore<TMessage, TExtra>; restored: boolean } {
    const existing = sessions.get(key)
    if (existing) return { store: existing.store, restored: true }
    const store = create()
    sessions.set(key, { store, leases: 0, detach: attachSession(key, store) })
    return { store, restored: false }
}

/** 视图挂载时登记占用 */
export function retainChatSession(key: string, store: ChatSessionStore<any, any>) {
    const entry = sessions.get(key)
    if (entry && entry.store === store) {
        entry.leases += 1
        return
    }
    if (entry) forgetSession(key, entry)
    sessions.set(key, { store, leases: 1, detach: attachSession(key, store) })
}

/**
 * 视图卸载时释放。没有视图在用且没有进行中的请求就销毁；
 * 还在生成则等请求结束再销毁，期间回到页面可以接上。
 */
export function releaseChatSession(key: string, store: ChatSessionStore<any, any>) {
    const entry = sessions.get(key)
    if (!entry || entry.store !== store) return
    entry.leases = Math.max(0, entry.leases - 1)
    if (entry.leases > 0) return
    store.onceIdle(() => {
        const current = sessions.get(key)
        if (current !== entry || current.leases > 0) return
        sessions.delete(key)
        forgetSession(key, entry)
        store.dispose()
    })
}

/** 测试用：清空所有会话 */
export function resetChatSessionsForTest() {
    for (const [key, entry] of sessions) {
        forgetSession(key, entry)
        entry.store.dispose()
    }
    sessions.clear()
    activeKeys.clear()
    activeKeysSnapshot = []
    activeListeners.clear()
    settledListeners.clear()
}
