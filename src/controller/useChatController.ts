import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type {
    BaseMessage,
    MessageLifecycle,
    UseChatControllerOptions,
    UseChatControllerResult
} from '../types'
import {
    ChatSessionStore,
    acquireChatSession,
    releaseChatSession,
    retainChatSession,
    type ChatSessionOptions
} from './chatSessionStore'

// 默认生命周期实现：作为简单示例，满足基础对话场景（纯文本流式）
function createDefaultLifecycle<
    TMessage extends BaseMessage = BaseMessage,
    TExtra = any
>(): MessageLifecycle<TMessage, TExtra> {
    return {
        onBeforeSend: (draft, ctx) => {
            const now = Date.now()
            draft.push({
                id: `${ctx.messageId}-user`,
                role: 'user',
                content: ctx.question,
                createdAt: now,
                updatedAt: now
            } as unknown as TMessage)
            // ai 占位；阶段由 controller 写入
            draft.push({
                id: ctx.messageId,
                role: 'ai',
                content: '',
                createdAt: now,
                updatedAt: now
            } as unknown as TMessage)
        },
        onStreamEvent: (draft, event, ctx) => {
            const target = draft.find((message) => message.id === ctx.messageId)
            if (!target) return
            // 默认视为文本增量事件：支持 text-delta/raw 两种 type
            if (event.type !== 'text-delta' && event.type !== 'raw') return
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const payload = (event.payload ?? event.raw ?? {}) as any
            const delta = payload.delta ?? payload.text ?? payload.answer ?? ''
            target.content = (target.content || '') + String(delta)
            target.updatedAt = event.timestamp
        },
        onClear: (draft) => {
            if (draft.length <= 1) return
            const first = draft[0]
            draft.length = 0
            draft.push(first)
        }
    }
}

interface StoreHolder<TMessage extends BaseMessage, TExtra> {
    key: string | undefined
    store: ChatSessionStore<TMessage, TExtra>
    restored: boolean
}

/**
 * 对话控制器：消息列表 + 进行中的请求。
 * 状态存在 ChatSessionStore（React 之外），组件通过 useSyncExternalStore 订阅。
 * 传 sessionKey 时同一个 key 共用一份状态，离开页面请求照常进行，回来时接上。
 */
export const useChatController = <TMessage extends BaseMessage = BaseMessage, TExtra = any>(
    options: UseChatControllerOptions<TMessage, TExtra>
): UseChatControllerResult<TMessage, TExtra> => {
    const { initialMessages, sessionKey, ...rest } = options
    const defaultLifecycle = useMemo(() => createDefaultLifecycle<TMessage, TExtra>(), [])
    const sessionOptions: ChatSessionOptions<TMessage, TExtra> = {
        ...rest,
        messageLifecycle: rest.messageLifecycle ?? defaultLifecycle
    }

    const createHolder = (key: string | undefined): StoreHolder<TMessage, TExtra> => {
        const create = () => new ChatSessionStore<TMessage, TExtra>(sessionOptions, initialMessages)
        if (!key) return { key, store: create(), restored: false }
        return { key, ...acquireChatSession(key, create) }
    }

    const [holder, setHolder] = useState(() => createHolder(sessionKey))
    let current = holder
    if (holder.key !== sessionKey) {
        current = createHolder(sessionKey)
        setHolder(current)
    }
    const { store, restored } = current
    // 始终使用最新的 buildRequest / 回调闭包
    store.setOptions(sessionOptions)

    useEffect(() => {
        if (!sessionKey) return
        retainChatSession(sessionKey, store)
        return () => releaseChatSession(sessionKey, store)
    }, [sessionKey, store])

    const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)

    return useMemo(
        () => ({
            messages: state.messages,
            loading: state.loading,
            activeMessageId: state.activeMessageId,
            restored,
            send: store.send,
            cancel: store.cancel,
            clear: store.clear,
            setMessages: store.setMessages
        }),
        [state, restored, store]
    )
}

export default useChatController
