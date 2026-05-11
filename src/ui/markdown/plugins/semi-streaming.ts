import type { Plugin } from 'unified'

export interface RemarkSemiStreamingOptions {
    /**
     * 是否尝试自动闭合代码围栏（```、~~~）
     */
    enableFences?: boolean
    /**
     * 是否尝试自动闭合行内强调（*、_、~~、`）
     */
    enableInline?: boolean
    /**
     * 是否尝试自动闭合链接目标 ([text](url))
     */
    enableLinks?: boolean
}

type StackEntry =
    | { type: 'emphasis'; marker: '*' | '_'; length: number }
    | { type: 'strike'; length: number }
    | { type: 'inlineCode'; length: number }
    | { type: 'fence'; marker: '`' | '~'; length: number }
    | { type: 'linkLabel' }
    | { type: 'linkDestination' }

const WRAPPED_KEY = 'remark-semi-streaming-parser-wrapped'

/**
 * remark 插件：在解析前补全未闭合的 Markdown 语法，降低流式渲染抖动
 */
export const remarkSemiStreaming: Plugin<[RemarkSemiStreamingOptions?]> = function (options = {}) {
    const data = this.data() as Record<string, unknown>
    if (data[WRAPPED_KEY]) {
        return
    }

    const originalParser = this.parser
    if (typeof originalParser !== 'function') {
        return
    }

    data[WRAPPED_KEY] = true

    this.parser = (value: unknown, file) => {
        const source = toValueString(value)
        const normalized = autoCloseMarkdown(source, options)

        if (file && typeof file === 'object' && 'value' in (file as any)) {
            ;(file as any).value = normalized
        }

        return originalParser.call(this, normalized, file)
    }
}

function autoCloseMarkdown(source: string, options: RemarkSemiStreamingOptions): string {
    if (!source) {
        return source
    }

    const state = analyzeMarkdown(source, options)
    if (!state.stack.length) {
        return source
    }

    const closers = buildClosers(state.stack, source, options)
    if (!closers) {
        return source
    }

    return source + closers
}

function analyzeMarkdown(source: string, options: RemarkSemiStreamingOptions) {
    const stack: StackEntry[] = []
    const inlineCodeLengths: number[] = []
    const fenceStack: { marker: '`' | '~'; length: number }[] = []
    let linkDestinationDepth = 0

    const pushEntry = (entry: StackEntry) => {
        stack.push(entry)
        if (entry.type === 'inlineCode') {
            inlineCodeLengths.push(entry.length)
        } else if (entry.type === 'fence') {
            fenceStack.push({ marker: entry.marker, length: entry.length })
        }
    }

    const removeEntry = (predicate: (entry: StackEntry) => boolean) => {
        for (let index = stack.length - 1; index >= 0; index--) {
            const entry = stack[index]
            if (predicate(entry)) {
                stack.splice(index, 1)
                if (entry.type === 'inlineCode') {
                    inlineCodeLengths.pop()
                } else if (entry.type === 'fence') {
                    fenceStack.pop()
                }
                return entry
            }
        }
        return undefined
    }

    const enableFences = options.enableFences !== false
    const enableInline = options.enableInline !== false
    const enableLinks = options.enableLinks !== false

    for (let index = 0; index < source.length; index++) {
        const char = source[index]
        const prev = index > 0 ? source[index - 1] : ''
        const startOfLine = index === 0 || source[index - 1] === '\n'

        // Link destination（[text](url) 的 url 部分）内部不应该解析强调/删除线/行内代码等分隔符；
        // 否则像 `.../_abc_def...` 这种 URL 会被误判为未闭合的 `_`，最终在尾部补出多余下划线。
        if (enableLinks && linkDestinationDepth > 0) {
            if (char === ')' && prev !== '\\') {
                const removed = removeEntry((entry) => entry.type === 'linkDestination')
                if (removed) {
                    linkDestinationDepth = Math.max(0, linkDestinationDepth - 1)
                }
            }
            continue
        }

        if (enableFences && startOfLine && (char === '`' || char === '~')) {
            let length = 1
            while (index + length < source.length && source[index + length] === char) {
                length++
            }

            if (length >= 3) {
                const marker = char as '`' | '~'
                const top = fenceStack[fenceStack.length - 1]
                if (top && top.marker === marker && top.length === length) {
                    removeEntry(
                        (entry) =>
                            entry.type === 'fence' &&
                            entry.marker === marker &&
                            entry.length === length
                    )
                } else {
                    pushEntry({ type: 'fence', marker, length })
                }

                index += length - 1
                continue
            }
        }

        const insideFence = fenceStack.length > 0

        if (enableInline && char === '`' && prev !== '\\') {
            let length = 1
            while (index + length < source.length && source[index + length] === '`') {
                length++
            }

            if (insideFence) {
                index += length - 1
                continue
            }

            const top = inlineCodeLengths[inlineCodeLengths.length - 1]
            if (top === length) {
                removeEntry((entry) => entry.type === 'inlineCode' && entry.length === length)
            } else {
                pushEntry({ type: 'inlineCode', length })
            }

            index += length - 1
            continue
        }

        const insideCode = inlineCodeLengths.length > 0 || insideFence
        if (insideCode) {
            continue
        }

        if (enableInline && char === '~' && prev !== '\\') {
            if (source[index + 1] === '~' && source[index + 2] !== '~') {
                const length = 2
                const before = index > 0 ? source[index - 1] : ''
                const after = source[index + length] ?? ''
                const { canOpen, canClose } = delimiterInfo('~', before, after)

                if (canClose) {
                    const closed = removeEntry((entry) => entry.type === 'strike')
                    if (!closed && canOpen) {
                        pushEntry({ type: 'strike', length })
                    }
                } else if (canOpen) {
                    pushEntry({ type: 'strike', length })
                }

                index += length - 1
                continue
            }
        }

        if (enableInline && (char === '*' || char === '_') && prev !== '\\') {
            const marker = char as '*' | '_'
            let length = 1
            while (index + length < source.length && source[index + length] === marker) {
                length++
            }

            const before = index > 0 ? source[index - 1] : ''
            const after = source[index + length] ?? ''
            const { canOpen, canClose } = delimiterInfo(marker, before, after)

            if (canClose) {
                let closed = removeEntry(
                    (entry) =>
                        entry.type === 'emphasis' &&
                        entry.marker === marker &&
                        entry.length === length
                )
                if (!closed) {
                    closed = removeEntry(
                        (entry) =>
                            entry.type === 'emphasis' &&
                            entry.marker === marker &&
                            entry.length !== undefined
                    )
                }
                if (!closed && canOpen) {
                    pushEntry({ type: 'emphasis', marker, length })
                }
            } else if (canOpen) {
                pushEntry({ type: 'emphasis', marker, length })
            }

            index += length - 1
            continue
        }

        if (enableLinks && char === '[' && prev !== '\\') {
            pushEntry({ type: 'linkLabel' })
            continue
        }

        if (enableLinks && char === ']' && prev !== '\\') {
            removeEntry((entry) => entry.type === 'linkLabel')
            continue
        }

        if (enableLinks && char === '(' && prev !== '\\') {
            const prevNonSpace = lastNonSpace(source, index - 1)
            if (prevNonSpace === ']') {
                pushEntry({ type: 'linkDestination' })
                linkDestinationDepth++
            }
            continue
        }

        if (enableLinks && char === ')' && prev !== '\\') {
            const removed = removeEntry((entry) => entry.type === 'linkDestination')
            if (removed) {
                linkDestinationDepth = Math.max(0, linkDestinationDepth - 1)
            }
        }
    }

    return {
        stack
    }
}

function buildClosers(
    entries: StackEntry[],
    source: string,
    options: RemarkSemiStreamingOptions
): string | null {
    if (!entries.length) {
        return null
    }

    const enableFences = options.enableFences !== false
    const enableInline = options.enableInline !== false
    const enableLinks = options.enableLinks !== false

    const pieces: string[] = []
    let trailingNewline = source.endsWith('\n')

    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index]
        switch (entry.type) {
            case 'emphasis':
                if (enableInline) {
                    pieces.push((entry.marker ?? '*').repeat(entry.length ?? 1))
                    trailingNewline = false
                }
                break
            case 'strike':
                if (enableInline) {
                    pieces.push('~'.repeat(entry.length ?? 2))
                    trailingNewline = false
                }
                break
            case 'inlineCode':
                if (enableInline) {
                    pieces.push('`'.repeat(entry.length ?? 1))
                    trailingNewline = false
                }
                break
            case 'linkDestination':
                if (enableLinks) {
                    pieces.push(')')
                    trailingNewline = false
                }
                break
            case 'linkLabel':
                if (enableLinks) {
                    pieces.push(']')
                    trailingNewline = false
                }
                break
            case 'fence':
                if (enableFences) {
                    const marker = entry.marker ?? '`'
                    const length = entry.length ?? 3
                    let fragment = ''
                    if (!trailingNewline) {
                        fragment += '\n'
                    }
                    fragment += marker.repeat(length)
                    fragment += '\n'
                    trailingNewline = true
                    pieces.push(fragment)
                }
                break
        }
    }

    if (!pieces.length) {
        return null
    }

    return pieces.join('')
}

function delimiterInfo(marker: '*' | '_' | '~', before: string, after: string) {
    const beforeIsWhitespace = isWhitespace(before)
    const afterIsWhitespace = isWhitespace(after)
    const beforeIsPunctuation = isPunctuation(before)
    const afterIsPunctuation = isPunctuation(after)

    const leftFlanking =
        !afterIsWhitespace && !(afterIsPunctuation && !beforeIsWhitespace && !beforeIsPunctuation)
    const rightFlanking =
        !beforeIsWhitespace && !(beforeIsPunctuation && !afterIsWhitespace && !afterIsPunctuation)

    if (marker === '_') {
        return {
            canOpen: leftFlanking && (!rightFlanking || beforeIsPunctuation || beforeIsWhitespace),
            canClose: rightFlanking && (!leftFlanking || afterIsPunctuation || afterIsWhitespace)
        }
    }

    return {
        canOpen: leftFlanking,
        canClose: rightFlanking
    }
}

function isWhitespace(char: string | undefined): boolean {
    if (!char) {
        return true
    }
    return /\s/.test(char)
}

function isPunctuation(char: string | undefined): boolean {
    if (!char) {
        return false
    }
    return /[!-/:-@[-`{-~]/.test(char)
}

function lastNonSpace(value: string, start: number): string {
    for (let index = start; index >= 0; index--) {
        const char = value[index]
        if (char && !/\s/.test(char)) {
            return char
        }
    }
    return ''
}

function toValueString(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }
    if (value && typeof value === 'object' && 'value' in (value as any)) {
        const v = (value as any).value
        return typeof v === 'string' ? v : String(v ?? '')
    }
    return String(value ?? '')
}
