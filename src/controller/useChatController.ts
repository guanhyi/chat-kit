import { useCallback, useMemo, useRef, useState } from 'react'
import { produce } from 'immer'
import type {
    BaseMessage,
    ChatSendInput,
    MessageLifecycle,
    StreamEvent,
    UseChatControllerOptions,
    UseChatControllerResult
} from '../types'
import { useChatStream } from '../stream/useChatStream'

// 默认生命周期实现：作为简单示例，满足基础对话场景（纯文本流式）
function createDefaultLifecycle<
    TMessage extends BaseMessage = BaseMessage,
    TExtra = any
>(): MessageLifecycle<TMessage, TExtra> {
    return {
        onBeforeSend: (draft, ctx) => {
            const idBase = Date.now().toString()
            // user 消息
            draft.push({
                id: `${idBase}-user`,
                role: 'user',
                content: ctx.question,
                createdAt: Date.now(),
                updatedAt: Date.now()
            } as unknown as TMessage)
            // ai 占位
            draft.push({
                id: `${idBase}-ai`,
                role: 'ai',
                content: '',
                loading: true,
                createdAt: Date.now(),
                updatedAt: Date.now()
            } as unknown as TMessage)
        },
        onStreamEvent: (draft, event, ctx) => {
            // 仅作为示例：把文本增量追加到最后一条 ai 消息
            const last = draft[draft.length - 1]
            if (!last || last.role !== 'ai') return

            const payload = (event as any).payload ?? (event as any).raw ?? {}

            // 默认视为文本增量事件：支持 text-delta/raw 两种 type
            if (event.type === 'text-delta' || event.type === 'raw') {
                const delta =
                    (payload as any).delta ??
                    (payload as any).text ??
                    (payload as any).answer ??
                    ''
                last.content = (last.content || '') + String(delta)
                last.updatedAt = Date.now()
            }

            // 默认结束事件：type === done 或 payload/raw 上携带 isEnd=true
            if (
                event.type === 'done' ||
                Boolean((payload as any).isEnd) ||
                Boolean((event as any).raw?.isEnd)
            ) {
                ;(last as any).loading = false
                last.updatedAt = Date.now()
            }
            void ctx
        },
        onCancel: (draft) => {
            const last = draft[draft.length - 1]
            if (!last) return
            ;(last as any).loading = false
            ;(last as any).isEnd = true
            last.updatedAt = Date.now()
        },
        onClear: (draft) => {
            if (draft.length <= 1) return
            const first = draft[0]
            draft.length = 0
            draft.push(first)
        }
    }
}

export const useChatController = <
    TMessage extends BaseMessage = BaseMessage,
    TExtra = any
>(
    options: UseChatControllerOptions<TMessage, TExtra>
): UseChatControllerResult<TMessage, TExtra> => {
    const { initialMessages, messageLifecycle: lifecycleFromOptions, ...streamOptions } = options

    const [messages, setMessagesState] = useState<TMessage[]>(() => initialMessages || [])

    // immer 风格 setMessages
    const setMessages = useCallback(
        (updater: (draft: TMessage[]) => void) => {
            setMessagesState((prev) =>
                produce(prev, (draft) => {
                    updater(draft as TMessage[])
                })
            )
        },
        []
    )

    const lifecycle: MessageLifecycle<TMessage, TExtra> = useMemo(
        () => lifecycleFromOptions || createDefaultLifecycle<TMessage, TExtra>(),
        [lifecycleFromOptions]
    )

    const lastCtxRef = useRef<{ question: string; extra?: TExtra } | null>(null)

    // 包装 parseEvent：在解析事件的同时驱动消息生命周期
    const mergedParseEvent = useCallback(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (raw: any): StreamEvent[] => {
            const baseParser = streamOptions.parseEvent
            const events: StreamEvent[] = baseParser ? baseParser(raw) : [{ type: 'raw', payload: raw, raw, timestamp: Date.now() }]

            if (lifecycle.onStreamEvent && events.length > 0) {
                const ctx = lastCtxRef.current
                if (ctx) {
                    setMessages((draft) => {
                        for (const ev of events) {
                            lifecycle.onStreamEvent?.(draft as TMessage[], ev, ctx)
                        }
                    })
                }
            }

            return events
        },
        [lifecycle, setMessages, streamOptions.parseEvent]
    )

    const { start, cancel: cancelStream, loading } = useChatStream<TExtra>({
        ...streamOptions,
        parseEvent: mergedParseEvent
    })

    const send = useCallback(
        (input: ChatSendInput<TExtra>) => {
            const ctx = { question: input.question, extra: input.extra }
            lastCtxRef.current = ctx

            if (lifecycle.onBeforeSend) {
                setMessages((draft) => {
                    lifecycle.onBeforeSend?.(draft as TMessage[], ctx)
                })
            }

            return start(input)
        },
        [lifecycle, setMessages, start]
    )

    const cancel = useCallback(() => {
        if (lifecycle.onCancel) {
            setMessages((draft) => {
                lifecycle.onCancel?.(draft as TMessage[])
            })
        }
        cancelStream()
    }, [cancelStream, lifecycle, setMessages])

    const clear = useCallback(() => {
        if (lifecycle.onClear) {
            setMessages((draft) => {
                lifecycle.onClear?.(draft as TMessage[])
            })
        } else {
            setMessages(() => [])
        }
    }, [lifecycle, setMessages])

    return {
        messages,
        loading,
        send,
        cancel,
        clear,
        setMessages
    }
}

export default useChatController
