// 输入框提问历史：空输入时 ↑/↓ 调出之前发过的问题。
// 逻辑移植自 ZCode packages/ui/src/lib/promptHistory.ts 与 promptHistoryStorage.ts（Apache-2.0）。
import { getBrowserStorage, readJson, writeJson, type StorageLike } from './storage'

export const MAX_PROMPT_HISTORY = 30

const PROMPT_HISTORY_STORAGE_KEY_PREFIX = 'chat-kit-prompt-history:v1:'

export type PromptHistoryDirection = 'up' | 'down'

export interface PromptHistoryNavigationResult {
    nextIndex: number | null
    nextValue: string
    shouldHandle: boolean
}

/** 追加一条历史。只和最后一条比较去重，A、B、A 这种非连续重复要保留。 */
export function appendPromptHistoryEntry(
    entries: readonly string[],
    entry: string,
    limit = MAX_PROMPT_HISTORY
): string[] {
    const trimmed = entry.trim()
    if (!trimmed) return [...entries]
    if (entries[entries.length - 1]?.trim() === trimmed) return [...entries]
    const normalizedLimit = Math.max(1, Math.trunc(limit))
    return [...entries, trimmed].slice(-normalizedLimit)
}

/**
 * 在历史里移动一步。currentIndex 为 null 表示还没进入历史浏览；
 * 从最新一条再往下会退出浏览并清空输入。
 */
export function navigatePromptHistory(
    entries: readonly string[],
    currentIndex: number | null,
    direction: PromptHistoryDirection
): PromptHistoryNavigationResult {
    if (entries.length === 0) {
        return { nextIndex: currentIndex, nextValue: '', shouldHandle: false }
    }

    if (direction === 'up') {
        const nextIndex = currentIndex === null ? entries.length - 1 : Math.max(currentIndex - 1, 0)
        return { nextIndex, nextValue: entries[nextIndex] ?? '', shouldHandle: true }
    }

    if (currentIndex === null) {
        const nextIndex = entries.length - 1
        return { nextIndex, nextValue: entries[nextIndex] ?? '', shouldHandle: true }
    }

    if (currentIndex >= entries.length - 1) {
        return { nextIndex: null, nextValue: '', shouldHandle: true }
    }

    const nextIndex = currentIndex + 1
    return { nextIndex, nextValue: entries[nextIndex] ?? '', shouldHandle: true }
}

/**
 * 上下键是否交给历史导航：只在空输入或已经在浏览历史时接管，
 * 避免抢走多行输入原本的光标移动；带修饰键和输入法组合中不接管。
 */
export function shouldNavigatePromptHistory(input: {
    text: string
    currentIndex: number | null
    hasModifier: boolean
    isComposing: boolean
}): boolean {
    if (input.hasModifier || input.isComposing) return false
    return input.currentIndex !== null || input.text.length === 0
}

function storageKey(scope: string) {
    return `${PROMPT_HISTORY_STORAGE_KEY_PREFIX}${scope}`
}

export function readPromptHistory(
    scope: string,
    storage: StorageLike | null = getBrowserStorage()
): string[] {
    const value = readJson(storage, storageKey(scope))
    if (!Array.isArray(value)) return []
    return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .slice(-MAX_PROMPT_HISTORY)
}

/** 读出、追加、写回。返回写入后的列表 */
export function recordPromptHistory(
    scope: string,
    entry: string,
    storage: StorageLike | null = getBrowserStorage()
): string[] {
    const next = appendPromptHistoryEntry(readPromptHistory(scope, storage), entry)
    writeJson(storage, storageKey(scope), next)
    return next
}
