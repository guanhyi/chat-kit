import { describe, expect, it } from 'vitest'
import {
    MAX_PROMPT_HISTORY,
    appendPromptHistoryEntry,
    navigatePromptHistory,
    readPromptHistory,
    recordPromptHistory,
    shouldNavigatePromptHistory
} from './promptHistory'
import {
    MAX_COMPOSER_DRAFTS,
    clearComposerDraft,
    readComposerDraft,
    saveComposerDraft
} from './composerDraft'
import type { StorageLike } from './storage'

function memoryStorage(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>()
    return {
        data,
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
            data.set(key, value)
        },
        removeItem: (key) => {
            data.delete(key)
        }
    }
}

describe('appendPromptHistoryEntry', () => {
    it('trims, skips blanks and consecutive duplicates only', () => {
        expect(appendPromptHistoryEntry([], '  ')).toEqual([])
        expect(appendPromptHistoryEntry(['A'], ' A ')).toEqual(['A'])
        expect(appendPromptHistoryEntry(['A', 'B'], 'A')).toEqual(['A', 'B', 'A'])
    })

    it('keeps only the most recent entries', () => {
        const entries = Array.from({ length: MAX_PROMPT_HISTORY }, (_, i) => `q${i}`)
        const next = appendPromptHistoryEntry(entries, 'latest')
        expect(next).toHaveLength(MAX_PROMPT_HISTORY)
        expect(next[0]).toBe('q1')
        expect(next[next.length - 1]).toBe('latest')
    })
})

describe('navigatePromptHistory', () => {
    const entries = ['A', 'B', 'C']

    it('does nothing without history', () => {
        expect(navigatePromptHistory([], null, 'up').shouldHandle).toBe(false)
    })

    it('walks up from the newest entry and stops at the oldest', () => {
        expect(navigatePromptHistory(entries, null, 'up')).toMatchObject({ nextIndex: 2, nextValue: 'C' })
        expect(navigatePromptHistory(entries, 2, 'up')).toMatchObject({ nextIndex: 1, nextValue: 'B' })
        expect(navigatePromptHistory(entries, 0, 'up')).toMatchObject({ nextIndex: 0, nextValue: 'A' })
    })

    it('walks down and exits browsing past the newest entry', () => {
        expect(navigatePromptHistory(entries, 1, 'down')).toMatchObject({ nextIndex: 2, nextValue: 'C' })
        expect(navigatePromptHistory(entries, 2, 'down')).toMatchObject({ nextIndex: null, nextValue: '' })
    })
})

describe('shouldNavigatePromptHistory', () => {
    it('only takes over arrows on empty input or while browsing', () => {
        const base = { hasModifier: false, isComposing: false }
        expect(shouldNavigatePromptHistory({ ...base, text: '', currentIndex: null })).toBe(true)
        expect(shouldNavigatePromptHistory({ ...base, text: '多行输入', currentIndex: null })).toBe(false)
        expect(shouldNavigatePromptHistory({ ...base, text: '历史条目', currentIndex: 1 })).toBe(true)
    })

    it('leaves modified keys and IME composition alone', () => {
        expect(
            shouldNavigatePromptHistory({ text: '', currentIndex: null, hasModifier: true, isComposing: false })
        ).toBe(false)
        expect(
            shouldNavigatePromptHistory({ text: '', currentIndex: null, hasModifier: false, isComposing: true })
        ).toBe(false)
    })
})

describe('prompt history storage', () => {
    it('records per scope and survives malformed data', () => {
        const storage = memoryStorage()
        recordPromptHistory('web', '第一个问题', storage)
        recordPromptHistory('web', '第二个问题', storage)
        recordPromptHistory('note', '别的地方', storage)
        expect(readPromptHistory('web', storage)).toEqual(['第一个问题', '第二个问题'])
        expect(readPromptHistory('note', storage)).toEqual(['别的地方'])

        storage.setItem('chat-kit-prompt-history:v1:web', '{broken')
        expect(readPromptHistory('web', storage)).toEqual([])
    })

    it('works without storage', () => {
        expect(readPromptHistory('web', null)).toEqual([])
        expect(recordPromptHistory('web', 'q', null)).toEqual(['q'])
    })
})

describe('composer drafts', () => {
    it('saves, reads and clears per scope', () => {
        const storage = memoryStorage()
        saveComposerDraft('chat-1', { text: '写了一半', content: { type: 'doc' } }, storage, 1)
        saveComposerDraft('chat-2', { text: '另一个会话' }, storage, 2)
        expect(readComposerDraft('chat-1', storage)).toEqual({
            text: '写了一半',
            content: { type: 'doc' },
            updatedAt: 1
        })
        clearComposerDraft('chat-1', storage)
        expect(readComposerDraft('chat-1', storage)).toBeNull()
        expect(readComposerDraft('chat-2', storage)?.text).toBe('另一个会话')
    })

    it('treats blank text as clearing the draft', () => {
        const storage = memoryStorage()
        saveComposerDraft('chat-1', { text: '内容' }, storage)
        saveComposerDraft('chat-1', { text: '   ' }, storage)
        expect(readComposerDraft('chat-1', storage)).toBeNull()
    })

    it('evicts the oldest drafts beyond the limit', () => {
        const storage = memoryStorage()
        for (let i = 0; i <= MAX_COMPOSER_DRAFTS; i++) {
            saveComposerDraft(`chat-${i}`, { text: `草稿 ${i}` }, storage, i)
        }
        expect(readComposerDraft('chat-0', storage)).toBeNull()
        expect(readComposerDraft(`chat-${MAX_COMPOSER_DRAFTS}`, storage)?.text).toBe(
            `草稿 ${MAX_COMPOSER_DRAFTS}`
        )
    })

    it('ignores malformed storage', () => {
        const storage = memoryStorage()
        storage.setItem('chat-kit-composer-drafts:v1', '"oops"')
        expect(readComposerDraft('chat-1', storage)).toBeNull()
        saveComposerDraft('chat-1', { text: '恢复正常' }, storage)
        expect(readComposerDraft('chat-1', storage)?.text).toBe('恢复正常')
    })
})
