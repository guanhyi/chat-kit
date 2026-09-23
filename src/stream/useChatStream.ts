import { useCallback, useRef, useState } from 'react'
import type { ChatSendInput, StreamEvent, UseChatStreamOptions, UseChatStreamResult } from '../types'
import { openChatStream, type ChatStreamConnection } from './openChatStream'

// 默认事件解析：简单把 JSON 包装为一个 "raw" 事件
// 调用方可以通过 options.parseEvent 注入更复杂的协议解析
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const defaultParseEvent = (raw: any): StreamEvent[] => [
    {
        type: 'raw',
        payload: raw,
        raw,
        timestamp: Date.now()
    }
]

// 默认结束判定：尝试读取 raw.isEnd
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const defaultIsFinal = (raw: any): boolean => Boolean(raw?.isEnd)

/**
 * 基于 rxjs + @ngify/http 的通用流式网络 Hook
 * - 不关心消息结构，只负责把 SSE 文本流解析成原始帧并交给 parseEvent / onRawEvent；
 * - 每次请求 onComplete（final / 连接正常结束）与 onError（出错 / 超时）恰好触发其一，取消时都不触发；
 * - 需要把事件写进消息列表时请用 useChatController。
 */
export const useChatStream = <TExtra = any>(
    options: UseChatStreamOptions<TExtra>
): UseChatStreamResult<TExtra> => {
    const [loading, setLoading] = useState(false)
    const connectionRef = useRef<ChatStreamConnection | null>(null)
    const optionsRef = useRef(options)
    optionsRef.current = options

    const cancel = useCallback(() => {
        connectionRef.current?.cancel()
        connectionRef.current = null
        setLoading(false)
    }, [])

    const start = useCallback((input: ChatSendInput<TExtra>) => {
        const { question, extra } = input
        connectionRef.current?.cancel()

        const current = optionsRef.current
        const request = current.buildRequest({ question, extra })
        setLoading(true)
        current.onOpen?.({ question, extra })

        // onEnd 可能在 openChatStream 返回前同步触发，用标记代替读取尚未赋值的连接
        let ended = false
        let self: ChatStreamConnection | null = null
        const connection = openChatStream({
            httpClient: current.httpClient,
            request,
            isFinal: (raw) => (optionsRef.current.isFinal || defaultIsFinal)(raw),
            idleTimeoutMs: current.idleTimeoutMs,
            onData: (raws) => {
                const latest = optionsRef.current
                const parse = latest.parseEvent || defaultParseEvent
                for (const raw of raws) {
                    latest.onRawEvent?.({ raw, question, extra, timestamp: Date.now() })
                    parse(raw)
                }
            },
            onEnd: ({ reason, error }) => {
                ended = true
                if (self && connectionRef.current === self) connectionRef.current = null
                setLoading(false)
                const latest = optionsRef.current
                if (reason === 'final' || reason === 'closed') latest.onComplete?.()
                else if (reason === 'error' || reason === 'timeout') latest.onError?.(error)
            }
        })
        self = connection
        if (!ended) connectionRef.current = connection
        return { unsubscribe: () => connection.cancel() }
    }, [])

    return {
        start,
        cancel,
        loading
    }
}

export default useChatStream
