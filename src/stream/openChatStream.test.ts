import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatStreamTimeoutError, openChatStream } from './openChatStream'
import { SseJsonParser } from './sseParser'
import { createFakeHttp, sseFrame as frame } from './__testing__/fakeHttp'

function open(http: ReturnType<typeof createFakeHttp>, idleTimeoutMs = 0) {
    const data: unknown[] = []
    const onEnd = vi.fn()
    const connection = openChatStream({
        httpClient: http.httpClient,
        request: { api: '/chat' },
        isFinal: (raw: any) => Boolean(raw?.isEnd),
        idleTimeoutMs,
        onData: (raws) => data.push(...raws),
        onEnd
    })
    return { data, onEnd, connection }
}

describe('SseJsonParser', () => {
    it('splits events across chunks and joins multi-line data', () => {
        const parser = new SseJsonParser()
        expect(parser.push('data: {"a":')).toEqual([])
        expect(parser.push('1}\n\ndata: {"b":2}\n')).toEqual([{ a: 1 }])
        expect(parser.push('\n')).toEqual([{ b: 2 }])
    })

    it('does not treat a CRLF split across chunks as an event boundary', () => {
        const parser = new SseJsonParser()
        expect(parser.push('data: {"a":\r')).toEqual([])
        expect(parser.push('\ndata: 1}\r\n\r\n')).toEqual([{ a: 1 }])
    })

    it('flushes the last event even without a trailing blank line', () => {
        const parser = new SseJsonParser()
        expect(parser.push('data: {"isEnd":true}')).toEqual([])
        expect(parser.flush()).toEqual([{ isEnd: true }])
    })

    it('skips invalid JSON and comment lines', () => {
        const onInvalid = vi.fn()
        const parser = new SseJsonParser(onInvalid)
        expect(parser.push(': ping\n\ndata: {oops}\n\ndata: {"ok":true}\n\n')).toEqual([{ ok: true }])
        expect(onInvalid).toHaveBeenCalledTimes(1)
    })
})

describe('openChatStream', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('ends once with final and ignores data after it', () => {
        const http = createFakeHttp()
        const { data, onEnd } = open(http)
        http.push(frame({ answer: 'a' }))
        http.push(frame({ answer: '', isEnd: true }) + frame({ answer: 'late' }))
        http.respond()
        expect(data).toEqual([{ answer: 'a' }, { answer: '', isEnd: true }])
        expect(onEnd).toHaveBeenCalledTimes(1)
        expect(onEnd).toHaveBeenCalledWith({ reason: 'final', error: undefined })
        // 收到最终帧后不主动断开，等后端正常结束
        expect(http.unsubscribed).toBe(false)
    })

    it('ends as closed when the response finishes without a final frame', () => {
        const http = createFakeHttp()
        const { data, onEnd } = open(http)
        http.push(frame({ answer: 'a' }) + 'data: {"answer":"tail"}')
        http.respond()
        expect(data).toEqual([{ answer: 'a' }, { answer: 'tail' }])
        expect(onEnd).toHaveBeenCalledWith({ reason: 'closed', error: undefined })
    })

    it('treats a trailing final frame without blank line as final', () => {
        const http = createFakeHttp()
        const { onEnd } = open(http)
        http.push('data: {"answer":"","isEnd":true}')
        http.respond()
        expect(onEnd).toHaveBeenCalledWith({ reason: 'final', error: undefined })
    })

    it('reports network errors', () => {
        const http = createFakeHttp()
        const { onEnd } = open(http)
        const error = { status: 500 }
        http.fail(error)
        expect(onEnd).toHaveBeenCalledWith({ reason: 'error', error })
    })

    it('times out when no data arrives for too long, and data resets the timer', () => {
        const http = createFakeHttp()
        const { onEnd } = open(http, 1000)
        vi.advanceTimersByTime(900)
        http.push(frame({ answer: 'a' }))
        vi.advanceTimersByTime(900)
        expect(onEnd).not.toHaveBeenCalled()
        vi.advanceTimersByTime(200)
        expect(onEnd).toHaveBeenCalledTimes(1)
        expect(onEnd.mock.calls[0][0].reason).toBe('timeout')
        expect(onEnd.mock.calls[0][0].error).toBeInstanceOf(ChatStreamTimeoutError)
        expect(http.unsubscribed).toBe(true)
    })

    it('cancels once and aborts the request', () => {
        const http = createFakeHttp()
        const { onEnd, connection } = open(http)
        connection.cancel()
        connection.cancel()
        http.respond()
        expect(onEnd).toHaveBeenCalledTimes(1)
        expect(onEnd).toHaveBeenCalledWith({ reason: 'cancelled', error: undefined })
        expect(http.unsubscribed).toBe(true)
    })
})
