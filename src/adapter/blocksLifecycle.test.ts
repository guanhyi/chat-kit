import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import type { BlockMessage, StreamContext, StreamEvent } from '../types'
import { createBlocksLifecycle } from './blocksLifecycle'
import { createBlocksParser } from './blocksProtocol'

const RAWS = [
    { answer: '<think>' },
    { answer: '先想一想' },
    { answer: '</think>' },
    { answer: '第一段正文' },
    { answer: '<tool name="search">' },
    { answer: '关键词' },
    { answer: '</tool>' },
    { answer: '第二段正文', docs: [{ id: 'doc-1', title: '文档一' }] },
    { answer: '', isEnd: true }
]

function parseAll(raws: unknown[]): StreamEvent[] {
    let seq = 0
    const parse = createBlocksParser(() => `b${++seq}`)
    return raws.flatMap((raw) => parse(raw))
}

const ctx: StreamContext = { question: 'q', messageId: 'ai-1' }

function baseMessages(): BlockMessage[] {
    return [
        { id: 'u-1', role: 'user', content: 'q' },
        { id: 'ai-1', role: 'loading', content: '' }
    ]
}

function applyAll(messages: BlockMessage[], events: StreamEvent[]) {
    const lifecycle = createBlocksLifecycle({ useExternalMessages: true })
    return produce(messages, (draft) => {
        for (const event of events) lifecycle.onStreamEvent?.(draft, event, ctx)
    })
}

describe('createBlocksParser', () => {
    it('assigns block ids at parse time and keeps interleaved order', () => {
        const events = parseAll(RAWS)
        expect(events.map((event) => [event.type, event.payload.blockId])).toEqual([
            ['thinking-start', 'b1'],
            ['thinking-delta', 'b1'],
            ['thinking-complete', 'b1'],
            ['text-start', 'b2'],
            ['text-delta', 'b2'],
            ['text-complete', 'b2'],
            ['tool-pending', 'b3'],
            ['tool-in-progress', 'b3'],
            ['tool-complete', 'b3'],
            ['citation-update', undefined],
            ['text-start', 'b4'],
            ['text-delta', 'b4'],
            // 空正文的最终帧只发 block-complete，由它把剩余块标记为结束
            ['block-complete', undefined]
        ])
    })

    it('keeps state per parser instance', () => {
        const parseA = createBlocksParser(() => 'a')
        const parseB = createBlocksParser(() => 'b')
        parseA({ answer: '<think>' })
        // B 没有打开中的思考块，正文应当直接开新的正文块
        expect(parseB({ answer: '正文' }).map((event) => event.type)).toEqual([
            'text-start',
            'text-delta'
        ])
    })
})

describe('blocks lifecycle', () => {
    it('builds blocks on the target message', () => {
        const next = applyAll(baseMessages(), parseAll(RAWS))
        const ai = next[1]
        expect(ai.role).toBe('ai')
        // 工具名单独断言：之前这里只比 type/content/status，
        // 所以名字退化成 'unknown' 时测试全绿，问题才一路漏到了线上
        expect(
            ai.blocks?.map((block) => [block.type, block.content, block.status, block.toolName])
        ).toEqual([
            ['thinking', '先想一想', 'success', undefined],
            ['mainText', '第一段正文', 'success', undefined],
            ['tool', '关键词', 'success', 'search'],
            ['citation', '', 'success', undefined],
            ['mainText', '第二段正文', 'success', undefined]
        ])
        expect(ai.answer).toBe('第一段正文第二段正文')
        expect(ai.docs).toMatchObject([{ id: 'doc-1', title: '文档一' }])
    })

    it('fills in a tool name that only arrives in a later frame', () => {
        const raws = [
            { answer: '<tool>关键词' },
            { answer: '更多</tool>', node: { name: 'organize' } }
        ]
        const next = applyAll(baseMessages(), parseAll(raws))
        const tool = next[1].blocks?.find((block) => block.type === 'tool')

        expect(tool?.toolName).toBe('organize')
        expect(tool?.content).toBe('关键词更多')
    })

    it('leaves the tool name empty instead of writing a fake placeholder', () => {
        const next = applyAll(baseMessages(), parseAll([{ answer: '<tool>关键词</tool>' }]))
        const tool = next[1].blocks?.find((block) => block.type === 'tool')

        expect(tool?.toolName).toBeUndefined()
    })

    it('is deterministic: applying the same events twice gives the same result', () => {
        const events = parseAll(RAWS)
        expect(applyAll(baseMessages(), events)).toEqual(applyAll(baseMessages(), events))
    })

    it('writes by message id even when other messages are appended after the target', () => {
        const events = parseAll(RAWS.slice(3, 4))
        const withNotice: BlockMessage[] = [...baseMessages(), { id: 'n-1', role: 'notice' }]
        const next = applyAll(withNotice, events)
        expect(next[1].blocks?.[0]?.content).toBe('第一段正文')
        expect(next[2]).toEqual({ id: 'n-1', role: 'notice' })
    })

    it('finalizes a placeholder that never received content', () => {
        const lifecycle = createBlocksLifecycle({ useExternalMessages: true })
        const next = produce(baseMessages(), (draft) => {
            lifecycle.onFinalize?.(
                draft,
                { phase: 'error', reason: 'error', receivedContent: false },
                ctx
            )
        })
        expect(next[1].role).toBe('ai')
        expect(next[1].blocks).toEqual([])
    })

    it('stops streaming blocks when the request ends early', () => {
        const events = parseAll(RAWS.slice(0, 2))
        const lifecycle = createBlocksLifecycle({ useExternalMessages: true })
        const next = produce(applyAll(baseMessages(), events), (draft) => {
            lifecycle.onFinalize?.(
                draft,
                { phase: 'cancelled', reason: 'cancelled', receivedContent: true },
                ctx
            )
        })
        expect(next[1].blocks?.[0]?.status).toBe('success')
        expect(next[1].isThinking).toBe(false)
    })
})
