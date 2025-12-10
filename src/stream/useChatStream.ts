import { useCallback, useRef, useState } from 'react'
import { HttpEventType, type HttpDownloadProgressEvent } from '@ngify/http'
import type { Subscription } from 'rxjs'
import type { ChatSendInput, StreamEvent, UseChatStreamOptions, UseChatStreamResult } from '../types'

// 默认事件解析：简单把 JSON 包装为一个 "raw" 事件
// 调用方可以通过 options.parseEvent 注入更复杂的协议解析
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const defaultParseEvent = (raw: any): StreamEvent[] => {
    const timestamp = Date.now()
    return [
        {
            type: 'raw',
            payload: raw,
            raw,
            timestamp
        }
    ]
}

// 默认结束判定：尝试读取 raw.isEnd
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const defaultIsFinal = (raw: any): boolean => {
    if (!raw) return false
    return !!(raw as any).isEnd
}

/**
 * 基于 rxjs + @ngify/http 的通用流式网络 Hook
 * - 不关心消息结构，只负责从 HttpDownloadProgressEvent 中解析文本流并转换为 StreamEvent[]
 * - SSE 文本格式约定：
 *   - 以空行 `\n\n` 分隔事件
 *   - 每个事件中，所有 `data:` 开头的行拼接为一个 JSON 字符串
 */
export const useChatStream = <TExtra = any>(
    options: UseChatStreamOptions<TExtra>
): UseChatStreamResult<TExtra> => {
    const { httpClient, buildRequest, parseEvent, isFinal, onOpen, onError, onComplete } = options

    const [loading, setLoading] = useState(false)
    const cancelRef = useRef<Subscription | null>(null)
    const completionRef = useRef<string | undefined>()
    const bufferRef = useRef<string>('')
    const offsetRef = useRef<number>(0)

    const cleanup = useCallback(() => {
        if (cancelRef.current) {
            cancelRef.current.unsubscribe()
            cancelRef.current = null
        }
        completionRef.current = undefined
        bufferRef.current = ''
        offsetRef.current = 0
    }, [])

    const cancel = useCallback(() => {
        if (cancelRef.current) {
            cancelRef.current.unsubscribe()
            cancelRef.current = null
        }
        setLoading(false)
    }, [])

    // 解析 bufferRef 中累积的文本，按 \n\n 分隔事件
    // 对每个事件体，提取 data: 行并 JSON.parse，然后交给 parseEvent
    const drainBuffer = useCallback(
        (handleRawData: (raw: any) => void) => {
            let buf = bufferRef.current
            if (!buf) return

            // 统一换行：\r\n、\r → \n
            buf = buf.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

            let pos = 0
            while ((pos = buf.indexOf('\n\n')) >= 0) {
                const eventText = buf.slice(0, pos)
                buf = buf.slice(pos + 2)

                const lines = eventText.split('\n')
                const dataLines: string[] = []
                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        dataLines.push(line.slice(5).trim())
                    }
                }
                const dataStr = dataLines.join('\n')
                if (!dataStr) {
                    continue
                }
                try {
                    const raw = JSON.parse(dataStr)
                    handleRawData(raw)
                } catch (e) {
                    // 非法 JSON 直接跳过，避免中断整个流
                    // eslint-disable-next-line no-console
                    console.warn('chat-kit: invalid JSON in event stream:', dataStr, e)
                }
            }

            bufferRef.current = buf
        },
        []
    )

    const start = useCallback(
        (input: ChatSendInput<TExtra>): Subscription => {
            const { question, extra } = input

            // 若已有进行中的流，先取消
            if (cancelRef.current) {
                cancelRef.current.unsubscribe()
                cancelRef.current = null
            }

            const { api, body, headers } = buildRequest({ question, extra })

            bufferRef.current = ''
            offsetRef.current = 0
            setLoading(true)

            // 交给调用方记录“请求已打开”
            onOpen?.({ question, extra })

            const sub = httpClient
                .post(api, body, {
                    observe: 'events',
                    responseType: 'text',
                    reportProgress: true,
                    headers
                })
                .subscribe({
                    next: (event) => {
                        switch (event.type) {
                            case HttpEventType.DownloadProgress: {
                                const progressEvent = event as HttpDownloadProgressEvent
                                const partialText = progressEvent.partialText || ''
                                const prevOffset = offsetRef.current || 0
                                const chunk = partialText.slice(prevOffset)
                                offsetRef.current = partialText.length
                                if (chunk) {
                                    bufferRef.current += chunk
                                    drainBuffer((raw) => {
                                        const finalChecker = isFinal || defaultIsFinal
                                        const parser = parseEvent || defaultParseEvent
                                        const events = parser(raw)
                                        // isFinal 只看原始数据，由调用方自己决定
                                        if (finalChecker(raw)) {
                                            completionRef.current = undefined
                                            setLoading(false)
                                            onComplete?.()
                                            // 不在这里自动取消订阅，让调用方决定何时取消
                                        }
                                        // 此处仅负责解析，具体如何消费事件由上层决定
                                        // 事件对象通过 parser 返回，通常在上层 parseEvent 实现中被使用
                                        void events
                                    })
                                }
                                break
                            }
                            case HttpEventType.Response: {
                                // 若此前没有任何 progress，或还有残留缓冲，则兜底解析一次
                                try {
                                    const bodyText = (event as any).body as string | undefined
                                    if (bodyText && offsetRef.current === 0) {
                                        bufferRef.current += bodyText
                                        drainBuffer((raw) => {
                                            const finalChecker = isFinal || defaultIsFinal
                                            const parser = parseEvent || defaultParseEvent
                                            const events = parser(raw)
                                            if (finalChecker(raw)) {
                                                completionRef.current = undefined
                                                setLoading(false)
                                                onComplete?.()
                                            }
                                            void events
                                        })
                                    }
                                } catch (e) {
                                    onError?.(e)
                                } finally {
                                    cleanup()
                                }
                                break
                            }
                            default:
                                break
                        }
                    },
                    error: (err) => {
                        setLoading(false)
                        onError?.(err)
                        cleanup()
                    }
                })

            cancelRef.current = sub
            return sub
        },
        [buildRequest, cleanup, drainBuffer, httpClient, isFinal, onComplete, onError, onOpen, parseEvent]
    )

    return {
        start,
        cancel,
        loading
    }
}

export default useChatStream

