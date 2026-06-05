import { describe, expect, it } from 'vitest'
import { transformCitations } from './utils'

describe('transformCitations', () => {
    it('removes citation markers that do not map to available docs', () => {
        const result = transformCitations('命中[引用:1]，不存在[引用:3]。', [
            { id: 'doc-1' },
            { id: 'doc-2' }
        ])

        expect(result).toBe('命中[#citation-1](citation-1)，不存在。')
    })

    it('removes markdown wrappers around invalid citation-only markers', () => {
        const result = transformCitations('有效**[引用:1]**，无效**[引用:2]**。', [
            { id: 'doc-1' }
        ])

        expect(result).toBe('有效**[#citation-1](citation-1)**，无效。')
    })
})
