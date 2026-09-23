import { describe, expect, it } from 'vitest'
import { getToolDisplayName } from './toolLabels'

describe('getToolDisplayName', () => {
    it('maps the node names the backend uses', () => {
        expect(getToolDisplayName('understand')).toBe('理解问题')
        expect(getToolDisplayName('search')).toBe('搜索')
        expect(getToolDisplayName('organize')).toBe('整理')
        expect(getToolDisplayName('generate')).toBe('生成')
    })

    it('ignores case when matching the exact table', () => {
        expect(getToolDisplayName('Search')).toBe('搜索')
    })

    it('prefers the more specific rule for knowledge base tooling', () => {
        expect(getToolDisplayName('kb_search')).toBe('知识库检索')
        expect(getToolDisplayName('knowledge_search')).toBe('知识库检索')
        expect(getToolDisplayName('web_search')).toBe('搜索')
    })

    it('falls back to the raw name for anything unmapped', () => {
        expect(getToolDisplayName('some_mcp_tool')).toBe('some_mcp_tool')
    })

    it('returns an empty string when there is no name', () => {
        expect(getToolDisplayName()).toBe('')
        expect(getToolDisplayName('')).toBe('')
        expect(getToolDisplayName('   ')).toBe('')
    })
})
