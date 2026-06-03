import { describe, expect, it } from 'vitest'
import type { Block } from '../../types'
import {
    ACTIVITY_TEXT_THROTTLE_MS,
    getActivitySummary,
    getCitationDocs,
    getNextActivityTextDisplay,
    getNextTypedActivityText
} from './ActivitySummaryBlock.utils'

const baseBlock = {
    status: 'success',
    createdAt: 1,
    updatedAt: 1
} satisfies Pick<Block, 'status' | 'createdAt' | 'updatedAt'>

describe('getActivitySummary', () => {
    it('uses a longer display throttle for streaming summaries', () => {
        expect(ACTIVITY_TEXT_THROTTLE_MS).toBe(900)
    })

    it('throttles streaming text updates within the display interval', () => {
        const current = { text: '思考中：第一段', updatedAt: 1000 }
        const result = getNextActivityTextDisplay(current, '思考中：第二段', {
            isStreaming: true,
            now: 1100
        })

        expect(result.state).toEqual(current)
        expect(result.remainingMs).toBe(800)
    })

    it('types sampled text toward the target in small steps', () => {
        expect(getNextTypedActivityText('思考中：', '思考中：abcdefghijkl', 4)).toBe('思考中：abcd')
    })

    it('keeps the shared prefix when typing to a changed target', () => {
        expect(getNextTypedActivityText('思考中：abcdef', '思考中：abXYZ', 2)).toBe('思考中：abXY')
    })

    it('updates final summary text immediately', () => {
        const result = getNextActivityTextDisplay(
            { text: '思考中：第一段', updatedAt: 1000 },
            '已思考',
            {
                isStreaming: false,
                now: 1100,
                throttleMs: 240
            }
        )

        expect(result.state).toEqual({ text: '已思考', updatedAt: 1100 })
        expect(result.remainingMs).toBe(0)
    })

    it('normalizes null history docs to an empty list', () => {
        expect(getCitationDocs([], null as any)).toEqual([])
    })

    it('shows the active tool call placeholder before content arrives', () => {
        const summary = getActivitySummary(
            [
                {
                    ...baseBlock,
                    id: 'thinking-1',
                    type: 'thinking',
                    content: 'thinking'
                },
                {
                    ...baseBlock,
                    id: 'tool-1',
                    type: 'tool',
                    status: 'streaming',
                    toolName: 'web_search',
                    content: ''
                }
            ],
            { loading: true }
        )

        expect(summary.text).toBe('搜索中...')
        expect(summary.hasDetails).toBe(true)
    })

    it('shows the latest thinking line while streaming', () => {
        const summary = getActivitySummary([
            {
                ...baseBlock,
                id: 'thinking-1',
                type: 'thinking',
                status: 'streaming',
                content: '先拆解问题\n**正在确认约束**'
            }
        ])

        expect(summary.text).toBe('思考中：正在确认约束')
        expect(summary.hasDetails).toBe(true)
    })

    it('shows the latest search content while streaming', () => {
        const summary = getActivitySummary([
            {
                ...baseBlock,
                id: 'tool-1',
                type: 'tool',
                status: 'streaming',
                toolName: 'web_search',
                content: '开始检索\n找到 3 条候选结果'
            }
        ])

        expect(summary.text).toBe('搜索中：找到 3 条候选结果')
        expect(summary.hasDetails).toBe(true)
    })

    it('keeps streaming excerpts short to reduce layout jitter', () => {
        const summary = getActivitySummary([
            {
                ...baseBlock,
                id: 'thinking-1',
                type: 'thinking',
                status: 'streaming',
                content: 'abcdefghijklmnopqrstuvwxyz1234567890'
            }
        ])

        expect(summary.text).toBe('思考中：abcdefghijklmnopqrstuvwx...')
    })

    it('summarizes completed thinking, tools, and citations in one line', () => {
        const summary = getActivitySummary(
            [
                {
                    ...baseBlock,
                    id: 'thinking-1',
                    type: 'thinking',
                    content: 'thinking'
                },
                {
                    ...baseBlock,
                    id: 'tool-1',
                    type: 'tool',
                    toolName: 'web_search',
                    content: 'done'
                },
                {
                    ...baseBlock,
                    id: 'citation-1',
                    type: 'citation',
                    docs: [
                        { id: '1', title: 'A' },
                        { id: '2', title: 'B' }
                    ]
                }
            ],
            { loading: false }
        )

        expect(summary.text).toBe('已思考 · 调用 1 个工具 · 引用 2 篇')
        expect(summary.hasDetails).toBe(true)
    })

    it('does not treat answer streaming as activity streaming', () => {
        const summary = getActivitySummary(
            [
                {
                    ...baseBlock,
                    id: 'thinking-1',
                    type: 'thinking',
                    content: 'thinking'
                }
            ],
            { loading: true }
        )

        expect(summary.text).toBe('已思考')
        expect(summary.isStreaming).toBe(false)
    })
})
