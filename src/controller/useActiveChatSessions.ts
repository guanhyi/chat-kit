import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
    getActiveChatSessionKeys,
    subscribeActiveChatSessions,
    subscribeChatSessionSettled,
    type ChatSessionSettledEvent
} from './chatSessionStore'

/**
 * 当前正在生成回复的会话 key（即 useChatController 的 sessionKey）。
 * 会话状态在 React 之外，切走页面也还在，所以会话列表、关闭确认这些
 * 不在对话页里的地方也能拿到它。
 */
export function useActiveChatSessions(): readonly string[] {
    return useSyncExternalStore(
        subscribeActiveChatSessions,
        getActiveChatSessionKeys,
        getActiveChatSessionKeys
    )
}

export function useIsChatSessionStreaming(key?: string | null): boolean {
    const keys = useActiveChatSessions()
    return Boolean(key) && keys.includes(key as string)
}

/** 任意会话的请求结束时回调。handler 每次渲染都取最新的闭包 */
export function useChatSessionSettled(handler: (event: ChatSessionSettledEvent) => void) {
    const handlerRef = useRef(handler)
    handlerRef.current = handler
    useEffect(() => subscribeChatSessionSettled((event) => handlerRef.current(event)), [])
}
