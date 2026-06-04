// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Observable } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { HttpEventType, type HttpDownloadProgressEvent } from '@ngify/http'
import { useChatStream } from './useChatStream'
import type { HttpClientLike } from '../types'

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('useChatStream', () => {
    it('notifies raw events even when parsed stream events are empty', async () => {
        const rawFrame = {
            answer: '',
            isEnd: false,
            status: 1,
            node: { id: 'node-1', name: '检索节点' }
        }
        const httpClient: HttpClientLike = {
            post: () =>
                new Observable((observer) => {
                    observer.next({
                        type: HttpEventType.DownloadProgress,
                        partialText: `data: ${JSON.stringify(rawFrame)}\n\n`
                    } as HttpDownloadProgressEvent)
                })
        }
        const onRawEvent = vi.fn()

        const Probe = () => {
            const startedRef = React.useRef(false)
            const stream = useChatStream({
                httpClient,
                buildRequest: () => ({ api: '/chat' }),
                parseEvent: () => [],
                onRawEvent
            })

            React.useEffect(() => {
                if (startedRef.current) return
                startedRef.current = true
                stream.start({ question: 'hello', extra: { source: 'test' } })
            }, [stream])

            return null
        }

        const container = document.createElement('div')
        const root = createRoot(container)

        await act(async () => {
            root.render(<Probe />)
        })

        expect(onRawEvent).toHaveBeenCalledWith({
            raw: rawFrame,
            question: 'hello',
            extra: { source: 'test' },
            timestamp: expect.any(Number)
        })

        await act(async () => {
            root.unmount()
        })
    })
})
