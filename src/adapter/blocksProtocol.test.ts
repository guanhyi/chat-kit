import { describe, expect, it } from 'vitest'
import { createBlocksParser, parseTagAttrs, resolveToolName } from './blocksProtocol'

const parseFrames = (frames: unknown[]) => {
    let seq = 0
    const parse = createBlocksParser(() => `b${++seq}`)
    return frames.flatMap((frame) => parse(frame))
}

const toolNames = (frames: unknown[]) =>
    parseFrames(frames)
        .filter((event) => event.type.startsWith('tool-'))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((event: any) => event.payload?.name)

const textOf = (frames: unknown[]) =>
    parseFrames(frames)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((event) => ['text-delta', 'text-complete'].includes(event.type))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((event: any) => event.payload?.text ?? '')
        .join('')

describe('parseTagAttrs', () => {
    it('accepts double quotes, single quotes and bare values', () => {
        expect(parseTagAttrs(' name="search"')).toEqual({ name: 'search' })
        expect(parseTagAttrs(" name='search'")).toEqual({ name: 'search' })
        expect(parseTagAttrs(' name=search')).toEqual({ name: 'search' })
    })

    it('normalizes attribute keys so toolName and tool_name land on the same key', () => {
        expect(parseTagAttrs(' toolName="search"')).toEqual({ toolname: 'search' })
        expect(parseTagAttrs(' tool_name="search"')).toEqual({ tool_name: 'search' })
    })
})

describe('resolveToolName', () => {
    it('falls through attribute names, then top-level fields, then node', () => {
        expect(resolveToolName({ name: 'search' })).toBe('search')
        expect(resolveToolName({ toolname: 'search' })).toBe('search')
        expect(resolveToolName({ type: 'search' })).toBe('search')
        expect(resolveToolName({}, { toolName: 'kb_search' })).toBe('kb_search')
        expect(resolveToolName({}, { tool_name: 'kb_search' })).toBe('kb_search')
        expect(resolveToolName({}, { name: 'kb_search' })).toBe('kb_search')
        expect(resolveToolName({}, { node: { name: 'organize' } })).toBe('organize')
    })

    it('returns an empty string instead of a fake placeholder name', () => {
        expect(resolveToolName({}, {})).toBe('')
        expect(resolveToolName({}, undefined)).toBe('')
    })
})

describe('createBlocksParser tool name', () => {
    it('reads the name from the tag attribute', () => {
        expect(toolNames([{ answer: '<tool name="search">kw</tool>' }])).toEqual([
            'search',
            'search',
            'search'
        ])
        expect(toolNames([{ answer: "<tool name='search'>kw</tool>" }])[0]).toBe('search')
        expect(toolNames([{ answer: '<tool name=search>kw</tool>' }])[0]).toBe('search')
        expect(toolNames([{ answer: '<tool name="知识库检索">kw</tool>' }])[0]).toBe('知识库检索')
    })

    it('reads the name from alternative attribute spellings', () => {
        expect(toolNames([{ answer: '<tool toolName="search">kw</tool>' }])[0]).toBe('search')
        expect(toolNames([{ answer: '<tool tool_name="search">kw</tool>' }])[0]).toBe('search')
        expect(toolNames([{ answer: '<tool type="search">kw</tool>' }])[0]).toBe('search')
    })

    it('reads the name from the SSE envelope when the tag has none', () => {
        expect(toolNames([{ answer: '<tool>kw</tool>', node: { name: 'organize' } }])[0]).toBe(
            'organize'
        )
        // 这一条以前是死代码：解析器只挑了 answer/isEnd/status/docs/node 五个字段，
        // 顶层 toolName 会被丢掉，于是名字永远回退成 'unknown'
        expect(toolNames([{ answer: '<tool>kw</tool>', toolName: 'kb_search' }])[0]).toBe(
            'kb_search'
        )
        expect(toolNames([{ answer: '<tool>kw</tool>', tool_name: 'kb_search' }])[0]).toBe(
            'kb_search'
        )
        expect(toolNames([{ answer: '<tool>kw</tool>', name: 'kb_search' }])[0]).toBe('kb_search')
    })

    it('keeps the name empty instead of inventing "unknown"', () => {
        expect(toolNames([{ answer: '<tool>kw</tool>' }])).toEqual(['', '', ''])
    })

    it('collects a name that only arrives in a later frame', () => {
        const names = toolNames([
            { answer: '<tool>kw' },
            { answer: 'more</tool>', node: { name: 'organize' } }
        ])

        expect(names).not.toContain('unknown')
        expect(names[names.length - 1]).toBe('organize')
    })
})

describe('createBlocksParser cross-frame tags', () => {
    it('builds the tool block when the opening tag itself is split across frames', () => {
        const frames = [{ answer: '<tool na' }, { answer: 'me="search">kw</tool>' }]
        const events = parseFrames(frames)
        const types = events.map((event) => event.type)

        expect(types).toEqual(['tool-pending', 'tool-in-progress', 'tool-complete'])
        expect(toolNames(frames)[0]).toBe('search')
        expect(textOf(frames)).toBe('')
    })

    it('emits the text before a split tag and holds back the half tag itself', () => {
        const frames = [{ answer: '正文<tool na' }, { answer: 'me="search">kw</tool>' }]

        expect(textOf(frames)).toBe('正文')
        expect(toolNames(frames)[0]).toBe('search')
    })

    it('does not hold back a plain less-than in prose', () => {
        expect(textOf([{ answer: 'a < b' }])).toBe('a < b')
        // `<toolx` 不是已知标签的开头，也不能被扣下
        expect(textOf([{ answer: '<toolx' }])).toBe('<toolx')
    })

    it('flushes a leftover half tag on the final frame instead of swallowing it', () => {
        const frames = [{ answer: '正文<to' }, { answer: '', isEnd: true }]

        expect(textOf(frames)).toBe('正文<to')
    })
})
