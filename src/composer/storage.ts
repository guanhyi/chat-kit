export interface StorageLike {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

/** 隐私模式、禁用站点数据时 localStorage 可能不存在或访问即抛错 */
export function getBrowserStorage(): StorageLike | null {
    if (typeof window === 'undefined') return null
    try {
        return window.localStorage
    } catch {
        return null
    }
}

export function readJson(storage: StorageLike | null, key: string): unknown {
    if (!storage) return null
    try {
        const raw = storage.getItem(key)
        return raw ? JSON.parse(raw) : null
    } catch {
        return null
    }
}

export function writeJson(storage: StorageLike | null, key: string, value: unknown): void {
    if (!storage) return
    try {
        storage.setItem(key, JSON.stringify(value))
    } catch {
        // 配额满或被禁用：草稿和历史只是便利功能，写不进去就算了
    }
}
