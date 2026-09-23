import { HttpEventType, type HttpDownloadProgressEvent } from '@ngify/http'
import type { HttpClientLike, StreamEndReason } from '../types'
import { SseJsonParser } from './sseParser'

export const DEFAULT_IDLE_TIMEOUT_MS = 60_000

/** 空闲超时产生的错误，onEnd 的 error 字段里会是它 */
export class ChatStreamTimeoutError extends Error {
    constructor(readonly idleMs: number) {
        super(`chat stream idle for ${idleMs}ms`)
        this.name = 'ChatStreamTimeoutError'
    }
}

export interface OpenChatStreamOptions {
    httpClient: HttpClientLike
    request: {
        api: string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body?: any
        headers?: Record<string, string>
    }
    /** 是否为最终帧；收到后按 final 结束，之后的数据不再处理 */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    isFinal: (raw: any) => boolean
    /** 多久没收到任何数据就按超时结束；0 关闭 */
    idleTimeoutMs?: number
    /** 同一段网络数据里解析出的原始帧，按到达顺序 */
    onData: (raws: unknown[]) => void
    /** 每次请求恰好调用一次 */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onEnd: (result: { reason: StreamEndReason; error?: any }) => void
}

export interface ChatStreamConnection {
    /** 主动取消：中断请求并按 cancelled 结束（已结束则什么都不做） */
    cancel: () => void
}

/**
 * 发起一次 SSE 流式请求。
 * 不论正常结束、没收到最终帧就断开、出错、超时还是取消，onEnd 都恰好调用一次，
 * 调用方可以放心在 onEnd 里给消息收尾。
 *
 * 收到最终帧后不主动中断连接：部分后端要等连接正常结束才落库。
 */
export function openChatStream(options: OpenChatStreamOptions): ChatStreamConnection {
    const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    const parser = new SseJsonParser((text, error) => {
        // eslint-disable-next-line no-console
        console.warn('chat-kit: invalid JSON in event stream:', text, error)
    })
    let ended = false
    let offset = 0
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    // eslint-disable-next-line prefer-const
    let subscription: { unsubscribe: () => void } | null = null

    const clearIdleTimer = () => {
        if (idleTimer !== null) {
            clearTimeout(idleTimer)
            idleTimer = null
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const end = (reason: StreamEndReason, error?: any) => {
        if (ended) return
        ended = true
        clearIdleTimer()
        options.onEnd({ reason, error })
    }

    const armIdleTimer = () => {
        if (!idleTimeoutMs || ended) return
        clearIdleTimer()
        idleTimer = setTimeout(() => {
            subscription?.unsubscribe()
            end('timeout', new ChatStreamTimeoutError(idleTimeoutMs))
        }, idleTimeoutMs)
    }

    const deliver = (raws: unknown[]) => {
        if (ended || raws.length === 0) return
        let finalIndex = -1
        for (let i = 0; i < raws.length; i++) {
            if (options.isFinal(raws[i])) {
                finalIndex = i
                break
            }
        }
        options.onData(finalIndex >= 0 ? raws.slice(0, finalIndex + 1) : raws)
        if (finalIndex >= 0) end('final')
    }

    const finishNormally = () => {
        if (ended) return
        deliver(parser.flush())
        end('closed')
    }

    armIdleTimer()
    subscription = options.httpClient
        .post(options.request.api, options.request.body, {
            observe: 'events',
            responseType: 'text',
            reportProgress: true,
            headers: options.request.headers
        })
        .subscribe({
            next: (event) => {
                if (ended) return
                if (event.type === HttpEventType.DownloadProgress) {
                    const partialText = (event as HttpDownloadProgressEvent).partialText || ''
                    const chunk = partialText.slice(offset)
                    offset = partialText.length
                    if (chunk) {
                        armIdleTimer()
                        deliver(parser.push(chunk))
                    }
                    return
                }
                if (event.type === HttpEventType.Response) {
                    // 没有任何 progress 事件时（例如后端一次性返回），用完整 body 兜底
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const bodyText = (event as any).body
                    if (typeof bodyText === 'string' && offset === 0 && bodyText) {
                        deliver(parser.push(bodyText))
                    }
                    finishNormally()
                }
            },
            error: (error) => {
                end('error', error)
            },
            complete: () => {
                finishNormally()
            }
        })

    return {
        cancel: () => {
            if (ended) return
            subscription?.unsubscribe()
            end('cancelled')
        }
    }
}
