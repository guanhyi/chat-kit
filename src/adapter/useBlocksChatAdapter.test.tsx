// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Observable } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { HttpEventType, type HttpDownloadProgressEvent } from '@ngify/http'
import type { HttpClientLike } from '../types'
import { useBlocksChatAdapter } from './useBlocksChatAdapter'

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('useBlocksChatAdapter', () => {
    it('passes raw stream events through adapter options', async () => {
        const rawFrame = {
            answer: '',
            isEnd: false,
            status: 1,
            node: { id: 'node-1' }
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
            const { sendMessage } = useBlocksChatAdapter({
                httpClient,
                buildRequest: () => ({ api: '/chat' }),
                roles: {},
                useExternalMessages: true,
                onRawEvent
            })

            React.useEffect(() => {
                if (startedRef.current) return
                startedRef.current = true
                sendMessage('hello', { source: 'adapter-test' })
            }, [sendMessage])

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
            extra: { source: 'adapter-test' },
            timestamp: expect.any(Number)
        })

        await act(async () => {
            root.unmount()
        })
    })
})
