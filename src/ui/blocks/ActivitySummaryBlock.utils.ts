import type { Block } from '../../types'
import type { CitationItem } from './CitationBlock'

export type ActivityBlock = Block & {
    type: 'thinking' | 'tool' | 'citation'
}

export interface ActivitySummary {
    text: string
    hasDetails: boolean
    isStreaming: boolean
    toolCount: number
    citationCount: number
}

export interface ActivityTextDisplayState {
    text: string
    updatedAt: number
}

export interface ActivityTextDisplayResult {
    state: ActivityTextDisplayState
    remainingMs: number
}

const ACTIVITY_TYPES = new Set(['thinking', 'tool', 'citation'])
const DEFAULT_EXCERPT_MAX_LENGTH = 24
export const ACTIVITY_TEXT_THROTTLE_MS = 900
export const ACTIVITY_TEXT_TYPE_INTERVAL_MS = 24
export const ACTIVITY_TEXT_TYPE_STEP = 2

export const toBlockStatus = (status: Block['status']) => {
    return status === 'streaming' ? 'streaming' : status === 'success' ? 'success' : 'idle'
}

export const isActivityBlock = (block: Block): block is ActivityBlock => {
    return ACTIVITY_TYPES.has(block.type)
}

export const getActivityBlocks = (blocks?: Block[] | null) => {
    return Array.isArray(blocks) ? blocks.filter(isActivityBlock) : []
}

export const getCitationDocs = (
    blocks?: ActivityBlock[] | null,
    fallbackDocs?: CitationItem[] | null
) => {
    const safeBlocks = Array.isArray(blocks) ? blocks : []
    const safeFallbackDocs = Array.isArray(fallbackDocs) ? fallbackDocs : []
    const blockDocs = safeBlocks
        .filter((block) => block.type === 'citation')
        .flatMap((block) => block.docs || []) as CitationItem[]

    return blockDocs.length > 0 ? blockDocs : safeFallbackDocs
}

const stripExcerptMarkup = (text: string) => {
    return text
        .replace(/<[^>]*>/g, '')
        .replace(/`{1,3}/g, '')
        .replace(/\*\*/g, '')
        .replace(/__/g, '')
        .replace(/~~/g, '')
        .replace(/^\s*[-*+]\s+/g, '')
        .trim()
}

const truncateExcerpt = (text: string, maxLength = DEFAULT_EXCERPT_MAX_LENGTH) => {
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

const formatActivityDuration = (durationMs: number) => {
    if (!Number.isFinite(durationMs) || durationMs < 1000) {
        return '1秒'
    }

    const totalSeconds = Math.round(durationMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60

    if (minutes === 0) {
        return `${seconds}秒`
    }

    return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分`
}

const getActivityDurationText = (blocks: ActivityBlock[]) => {
    const times = blocks
        .flatMap((block) => [block.createdAt, block.updatedAt])
        .filter((time) => Number.isFinite(time))

    if (times.length === 0) {
        return '1秒'
    }

    return formatActivityDuration(Math.max(...times) - Math.min(...times))
}

export const getLatestActivityExcerpt = (content?: string) => {
    if (!content) {
        return ''
    }

    const lines = content.split(/\r?\n/).map(stripExcerptMarkup).filter(Boolean)
    const latestLine = lines[lines.length - 1]

    return latestLine ? truncateExcerpt(latestLine) : ''
}

const getToolStageLabel = (toolName?: string) => {
    if (!toolName) {
        return '正在调用工具'
    }

    return /search|检索|搜索/i.test(toolName) ? '搜索中' : `正在调用 ${toolName}`
}

const getStreamingText = (label: string, content?: string) => {
    const excerpt = getLatestActivityExcerpt(content)
    return excerpt ? `${label}：${excerpt}` : `${label}...`
}

export const getNextActivityTextDisplay = (
    current: ActivityTextDisplayState,
    nextText: string,
    options: {
        isStreaming: boolean
        now: number
        throttleMs?: number
    }
): ActivityTextDisplayResult => {
    if (current.text === nextText) {
        return { state: current, remainingMs: 0 }
    }

    const throttleMs = options.throttleMs ?? ACTIVITY_TEXT_THROTTLE_MS

    if (!options.isStreaming || !current.text) {
        return {
            state: { text: nextText, updatedAt: options.now },
            remainingMs: 0
        }
    }

    const elapsed = options.now - current.updatedAt
    if (elapsed >= throttleMs) {
        return {
            state: { text: nextText, updatedAt: options.now },
            remainingMs: 0
        }
    }

    return {
        state: current,
        remainingMs: throttleMs - elapsed
    }
}

const getCommonPrefixLength = (left: string, right: string) => {
    const maxLength = Math.min(left.length, right.length)
    for (let index = 0; index < maxLength; index++) {
        if (left[index] !== right[index]) {
            return index
        }
    }
    return maxLength
}

export const getNextTypedActivityText = (currentText: string, targetText: string, step: number) => {
    if (currentText === targetText) {
        return currentText
    }

    const commonPrefixLength = getCommonPrefixLength(currentText, targetText)
    const nextLength = Math.min(commonPrefixLength + step, targetText.length)
    return targetText.slice(0, nextLength)
}

export const getActivitySummary = (
    blocks?: Block[] | null,
    options: { docs?: CitationItem[] | null; loading?: boolean } = {}
): ActivitySummary => {
    const activityBlocks = getActivityBlocks(blocks)
    const thinkingBlocks = activityBlocks.filter((block) => block.type === 'thinking')
    const toolBlocks = activityBlocks.filter((block) => block.type === 'tool')
    const citationDocs = getCitationDocs(activityBlocks, options.docs || [])
    const activeTool = toolBlocks.find((block) => block.status === 'streaming')
    const activeThinking = thinkingBlocks.find((block) => block.status === 'streaming')
    const activeCitation = activityBlocks.find(
        (block) => block.type === 'citation' && block.status === 'streaming'
    )
    const isStreaming = Boolean(activeTool || activeThinking || activeCitation)
    const hasDetails = activityBlocks.length > 0 || citationDocs.length > 0

    if (!hasDetails) {
        return {
            text: '',
            hasDetails: false,
            isStreaming,
            toolCount: 0,
            citationCount: 0
        }
    }

    if (isStreaming) {
        if (activeTool) {
            return {
                text: getStreamingText(getToolStageLabel(activeTool.toolName), activeTool.content),
                hasDetails,
                isStreaming,
                toolCount: toolBlocks.length,
                citationCount: citationDocs.length
            }
        }

        if (activeThinking) {
            return {
                text: getStreamingText('思考中', activeThinking.content),
                hasDetails,
                isStreaming,
                toolCount: toolBlocks.length,
                citationCount: citationDocs.length
            }
        }

        if (activeCitation || citationDocs.length > 0) {
            const citationText =
                activeCitation?.content ||
                (citationDocs.length > 0 ? `已匹配 ${citationDocs.length} 篇参考文档` : '')
            return {
                text: getStreamingText('整理引用', citationText),
                hasDetails,
                isStreaming,
                toolCount: toolBlocks.length,
                citationCount: citationDocs.length
            }
        }

        return {
            text: '处理中...',
            hasDetails,
            isStreaming,
            toolCount: toolBlocks.length,
            citationCount: citationDocs.length
        }
    }

    const completedParts = [
        thinkingBlocks.length > 0 ? `思考 ${thinkingBlocks.length} 段` : '',
        toolBlocks.length > 0 ? `工具 ${toolBlocks.length} 个` : '',
        citationDocs.length > 0 ? `引用 ${citationDocs.length} 篇` : '',
        `用时 ${getActivityDurationText(activityBlocks)}`
    ].filter(Boolean)

    return {
        text: `已完成：${completedParts.join(' · ')}`,
        hasDetails,
        isStreaming,
        toolCount: toolBlocks.length,
        citationCount: citationDocs.length
    }
}
