// 输入框草稿按会话保存到 localStorage（思路同 ZCode v4/composer/composerDraftStore.ts）。
// 只存正文；附件含 File 对象不可序列化，不入草稿。发送只清当前会话的草稿。
import { getBrowserStorage, readJson, writeJson, type StorageLike } from './storage'

const COMPOSER_DRAFT_STORAGE_KEY = 'chat-kit-composer-drafts:v1'

/** 超出后按 updatedAt 淘汰最旧的草稿，防止长期使用后无限增长 */
export const MAX_COMPOSER_DRAFTS = 50

export interface ComposerDraft<TContent = unknown> {
    /** 纯文本，用于判空和降级恢复 */
    text: string
    /** 编辑器原生结构（如 Tiptap JSON），恢复时优先使用 */
    content?: TContent
    updatedAt: number
}

type DraftFile = {
    version: 1
    scopes: Record<string, ComposerDraft>
}

function readDraftFile(storage: StorageLike | null): DraftFile {
    const value = readJson(storage, COMPOSER_DRAFT_STORAGE_KEY) as Partial<DraftFile> | null
    if (!value || value.version !== 1 || typeof value.scopes !== 'object' || !value.scopes) {
        return { version: 1, scopes: {} }
    }
    return { version: 1, scopes: value.scopes }
}

export function readComposerDraft<TContent = unknown>(
    scope: string,
    storage: StorageLike | null = getBrowserStorage()
): ComposerDraft<TContent> | null {
    const draft = readDraftFile(storage).scopes[scope]
    if (!draft || typeof draft.text !== 'string' || !draft.text.trim()) return null
    return draft as ComposerDraft<TContent>
}

/** 保存草稿；正文为空等同于清除 */
export function saveComposerDraft<TContent = unknown>(
    scope: string,
    draft: { text: string; content?: TContent },
    storage: StorageLike | null = getBrowserStorage(),
    now: number = Date.now()
): void {
    if (!draft.text.trim()) {
        clearComposerDraft(scope, storage)
        return
    }
    const file = readDraftFile(storage)
    file.scopes[scope] = { text: draft.text, content: draft.content, updatedAt: now }
    const scopes = Object.entries(file.scopes)
    if (scopes.length > MAX_COMPOSER_DRAFTS) {
        scopes.sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
        file.scopes = Object.fromEntries(scopes.slice(0, MAX_COMPOSER_DRAFTS))
    }
    writeJson(storage, COMPOSER_DRAFT_STORAGE_KEY, file)
}

export function clearComposerDraft(
    scope: string,
    storage: StorageLike | null = getBrowserStorage()
): void {
    const file = readDraftFile(storage)
    if (!(scope in file.scopes)) return
    delete file.scopes[scope]
    writeJson(storage, COMPOSER_DRAFT_STORAGE_KEY, file)
}
