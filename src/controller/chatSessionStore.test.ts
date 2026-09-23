import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockMessage } from '../types'
import { createBlocksLifecycle } from '../adapter/blocksLifecycle'
import { createFakeHttp, sseFrame } from '../stream/__testing__/fakeHttp'
import {
    ChatSessionStore,
    acquireChatSession,
    releaseChatSession,
    resetChatSessionsForTest,
    retainChatSession
} from './chatSessionStore'

function createStore(http = createFakeHttp(), overrides: Record<string, unknown> = {}) {
    const onComplete = vi.fn()
    const onError = vi.fn()
    const store = new ChatSessionStore<BlockMessage>(
        {
            httpClient: http.httpClient,
            buildRequest: () => ({ api: '/chat' }),
            idleTimeoutMs: 0,
            messageLifecycle: createBlocksLifecycle({ useExternalMessages: true }),
            onComplete,
            onError,
            ...overrides
        },
        [{ id: 'start', role: 'start' }]
    )
    return { store, http, onComplete, onError }
}

/** 模拟 ChatView：自己插入用户消息和占位消息，再按 id 发送 */
function sendWithPlaceholder(store: ChatSessionStore<BlockMessage>, id = 'ai-1') {
    store.setMessages((draft) => {
        draft.push({ id: `${id}-user`, role: 'user', content: 'q' })
        draft.push({ id, role: 'loading', content: '' })
    })
    store.send({ question: 'q' }, { messageId: id })
}

const byId = (store: ChatSessionStore<BlockMessage>, id: string) =>
    store.getState().messages.find((message) => message.id === id)!

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
    resetChatSessionsForTest()
})

describe('ChatSessionStore', () => {
    it('marks the target pending, then streaming, then done', () => {
        const { store, http, onComplete } = createStore()
        sendWithPlaceholder(store)
        expect(byId(store, 'ai-1').phase).toBe('pending')
        expect(store.getState()).toMatchObject({ loading: true, activeMessageId: 'ai-1' })

        http.push(sseFrame({ answer: '你好' }))
        vi.runOnlyPendingTimers()
        expect(byId(store, 'ai-1')).toMatchObject({ phase: 'streaming', role: 'ai', loading: true })

        http.push(sseFrame({ answer: '', isEnd: true }))
        const ai = byId(store, 'ai-1')
        expect(ai).toMatchObject({ phase: 'done', loading: false, isEnd: true, answer: '你好' })
        expect(ai.blocks?.every((block) => block.status === 'success')).toBe(true)
        expect(store.getState()).toMatchObject({ loading: false, activeMessageId: null })
        expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('batches events that arrive before the next frame into one update', () => {
        const { store, http } = createStore()
        sendWithPlaceholder(store)
        const listener = vi.fn()
        store.subscribe(listener)
        http.push(sseFrame({ answer: 'a' }))
        http.push(sseFrame({ answer: 'b' }))
        http.push(sseFrame({ answer: 'c' }))
        expect(listener).not.toHaveBeenCalled()
        vi.runOnlyPendingTimers()
        expect(listener).toHaveBeenCalledTimes(1)
        expect(byId(store, 'ai-1').answer).toBe('abc')
    })

    it('keeps writing to the target even if messages are appended during streaming', () => {
        const { store, http } = createStore()
        sendWithPlaceholder(store)
        http.push(sseFrame({ answer: '前半' }))
        vi.runOnlyPendingTimers()
        store.setMessages((draft) => {
            draft.push({ id: 'notice', role: 'notice', content: '系统提示' })
        })
        http.push(sseFrame({ answer: '后半' }))
        http.push(sseFrame({ answer: '', isEnd: true }))
        expect(byId(store, 'ai-1').answer).toBe('前半后半')
        expect(byId(store, 'notice')).toEqual({ id: 'notice', role: 'notice', content: '系统提示' })
    })

    it('finalizes as error with a visible message when the request fails before any content', () => {
        const { store, http, onError } = createStore()
        sendWithPlaceholder(store)
        const error = { status: 500 }
        http.fail(error)
        expect(byId(store, 'ai-1')).toMatchObject({
            role: 'ai',
            phase: 'error',
            loading: false,
            errorText: '哎呀，出错了，请稍后再试'
        })
        expect(onError).toHaveBeenCalledWith(error)
        expect(store.getState().loading).toBe(false)
    })

    it('keeps received content and stops spinners when failing mid-stream', () => {
        const { store, http } = createStore()
        sendWithPlaceholder(store)
        http.push(sseFrame({ answer: '<think>' }) + sseFrame({ answer: '想' }))
        http.fail(new Error('network'))
        const ai = byId(store, 'ai-1')
        expect(ai.phase).toBe('error')
        expect(ai.isThinking).toBe(false)
        expect(ai.blocks?.[0]).toMatchObject({ type: 'thinking', content: '想', status: 'success' })
    })

    it('finishes as done when the connection closes after content without a final frame', () => {
        const { store, http, onComplete } = createStore()
        sendWithPlaceholder(store)
        http.push(sseFrame({ answer: '完整回答' }))
        http.respond()
        expect(byId(store, 'ai-1')).toMatchObject({ phase: 'done', answer: '完整回答' })
        expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('finishes as error when the connection closes without any content', () => {
        const { store, http } = createStore()
        sendWithPlaceholder(store)
        http.respond()
        expect(byId(store, 'ai-1')).toMatchObject({
            phase: 'error',
            errorText: '没有收到回复，请稍后再试'
        })
    })

    it('times out when the server goes silent', () => {
        const { store, http } = createStore(undefined, { idleTimeoutMs: 1000 })
        sendWithPlaceholder(store)
        http.push(sseFrame({ answer: '一半' }))
        vi.advanceTimersByTime(1000)
        expect(byId(store, 'ai-1')).toMatchObject({
            phase: 'error',
            errorText: '响应超时，请稍后再试',
            answer: '一半'
        })
        expect(http.unsubscribed).toBe(true)
    })

    it('cancels into a finished message instead of an endless placeholder', () => {
        const { store, http, onError, onComplete } = createStore()
        sendWithPlaceholder(store)
        store.cancel()
        expect(byId(store, 'ai-1')).toMatchObject({ role: 'ai', phase: 'cancelled', loading: false })
        expect(http.unsubscribed).toBe(true)
        expect(onError).not.toHaveBeenCalled()
        expect(onComplete).not.toHaveBeenCalled()
    })

    it('falls back to the last message and assigns an id when none is given', () => {
        const { store, http } = createStore()
        store.setMessages((draft) => {
            draft.push({ role: 'loading', content: '' })
        })
        store.send({ question: 'q' })
        const id = store.getState().activeMessageId!
        expect(store.getState().messages[1].id).toBe(id)
        http.push(sseFrame({ answer: 'ok', isEnd: true }))
        expect(byId(store, id)).toMatchObject({ phase: 'done', answer: 'ok' })
    })

    it('ignores events for a message that was removed', () => {
        const { store, http } = createStore()
        sendWithPlaceholder(store)
        store.setMessages((draft) => {
            draft.length = 1
        })
        http.push(sseFrame({ answer: 'x', isEnd: true }))
        expect(store.getState().messages).toEqual([{ id: 'start', role: 'start' }])
        expect(store.getState().loading).toBe(false)
    })
})

describe('chat session registry', () => {
    it('keeps a streaming session alive after its view unmounts and hands it back', () => {
        const http = createFakeHttp()
        const create = () => createStore(http).store
        const first = acquireChatSession('chat-1', create)
        expect(first.restored).toBe(false)
        retainChatSession('chat-1', first.store)
        sendWithPlaceholder(first.store)
        http.push(sseFrame({ answer: '生成中' }))
        releaseChatSession('chat-1', first.store)

        const second = acquireChatSession('chat-1', create)
        expect(second.restored).toBe(true)
        expect(second.store).toBe(first.store)
        retainChatSession('chat-1', second.store)
        vi.runOnlyPendingTimers()
        expect(byId(second.store, 'ai-1').answer).toBe('生成中')
        releaseChatSession('chat-1', second.store)

        http.push(sseFrame({ answer: '', isEnd: true }))
        const third = acquireChatSession('chat-1', create)
        expect(third.restored).toBe(false)
        expect(third.store).not.toBe(first.store)
    })

    it('disposes an idle session as soon as its last view is released', () => {
        const create = () => createStore().store
        const { store } = acquireChatSession('chat-2', create)
        retainChatSession('chat-2', store)
        releaseChatSession('chat-2', store)
        expect(acquireChatSession('chat-2', create).store).not.toBe(store)
    })
})
