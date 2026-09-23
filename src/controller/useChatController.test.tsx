// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { BlockMessage, UseChatControllerResult } from '../types'
import { useBlocksChatAdapter } from '../adapter/useBlocksChatAdapter'
import { createFakeHttp, sseFrame } from '../stream/__testing__/fakeHttp'
import { resetChatSessionsForTest } from './chatSessionStore'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

type Controller = UseChatControllerResult<BlockMessage>

function mount(http: ReturnType<typeof createFakeHttp>, sessionKey: string) {
    let controller!: Controller
    const Probe = () => {
        controller = useBlocksChatAdapter({
            httpClient: http.httpClient,
            buildRequest: () => ({ api: '/chat' }),
            roles: {},
            sessionKey,
            idleTimeoutMs: 0
        }).controller
        return null
    }
    const root: Root = createRoot(document.createElement('div'))
    act(() => root.render(<Probe />))
    return {
        get controller() {
            return controller
        },
        unmount: () => act(() => root.unmount())
    }
}

const flushFrames = () => act(async () => new Promise((resolve) => setTimeout(resolve, 60)))

afterEach(() => {
    resetChatSessionsForTest()
})

describe('useChatController with sessionKey', () => {
    it('reattaches to a session that is still streaming after remount', async () => {
        const http = createFakeHttp()
        const first = mount(http, 'chat-a')
        expect(first.controller.restored).toBe(false)
        act(() => {
            first.controller.send({ question: '你好' })
        })
        act(() => http.push(sseFrame({ answer: '正在' })))
        await flushFrames()
        first.unmount()

        // 离开期间继续收到内容
        http.push(sseFrame({ answer: '生成' }))

        const second = mount(http, 'chat-a')
        await flushFrames()
        expect(second.controller.restored).toBe(true)
        expect(second.controller.loading).toBe(true)
        const ai = second.controller.messages.find((message) => message.role === 'ai')
        expect(ai?.answer).toBe('正在生成')

        act(() => http.push(sseFrame({ answer: '', isEnd: true })))
        expect(second.controller.loading).toBe(false)
        second.unmount()

        const third = mount(http, 'chat-a')
        expect(third.controller.restored).toBe(false)
        expect(third.controller.messages).toEqual([])
        third.unmount()
    })
})
