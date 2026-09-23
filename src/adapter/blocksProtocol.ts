// 块协议解析：服务端 ChatSSE → Chunk → BlockStreamEvent。
// 解析器按请求创建，跨帧状态（标签栈、正文是否已开始、打开中的块 id）都在解析器闭包里；
// 事件里带上确定的 blockId，生命周期只按 id 应用，不再自己生成 id。
import type { StreamEvent } from '../types'

// ===================== Chunk 定义（与 useStreamController 保持一致） =====================

const CHUNK_TYPE = {
    TEXT_START: 'TEXT_START',
    TEXT_DELTA: 'TEXT_DELTA',
    TEXT_COMPLETE: 'TEXT_COMPLETE',
    THINKING_START: 'THINKING_START',
    THINKING_DELTA: 'THINKING_DELTA',
    THINKING_COMPLETE: 'THINKING_COMPLETE',
    TOOL_PENDING: 'TOOL_PENDING',
    TOOL_IN_PROGRESS: 'TOOL_IN_PROGRESS',
    TOOL_COMPLETE: 'TOOL_COMPLETE',
    CITATION_UPDATE: 'CITATION_UPDATE',
    BLOCK_COMPLETE: 'BLOCK_COMPLETE',
    ERROR: 'ERROR'
} as const

type ChunkType = (typeof CHUNK_TYPE)[keyof typeof CHUNK_TYPE]

type BaseChunk = {
    type: ChunkType
    ts?: number
}

type TextStart = BaseChunk & { type: typeof CHUNK_TYPE.TEXT_START }
type TextDelta = BaseChunk & { type: typeof CHUNK_TYPE.TEXT_DELTA; text: string }
type TextComplete = BaseChunk & { type: typeof CHUNK_TYPE.TEXT_COMPLETE; text: string }

type ThinkingStart = BaseChunk & { type: typeof CHUNK_TYPE.THINKING_START }
type ThinkingDelta = BaseChunk & { type: typeof CHUNK_TYPE.THINKING_DELTA; text: string }
type ThinkingComplete = BaseChunk & {
    type: typeof CHUNK_TYPE.THINKING_COMPLETE
    text: string
    thinking_ms?: number
}

type CitationUpdate = BaseChunk & {
    type: typeof CHUNK_TYPE.CITATION_UPDATE
    docs: Array<{ id: string; title: string; url?: string; extra?: any }>
}

type ToolPending = BaseChunk & { type: typeof CHUNK_TYPE.TOOL_PENDING; name: string }
type ToolInProgress = BaseChunk & {
    type: typeof CHUNK_TYPE.TOOL_IN_PROGRESS
    name: string
    data?: any
}
type ToolComplete = BaseChunk & {
    type: typeof CHUNK_TYPE.TOOL_COMPLETE
    name: string
    data?: any
}

type BlockComplete = BaseChunk & { type: typeof CHUNK_TYPE.BLOCK_COMPLETE }
type ErrorChunk = BaseChunk & { type: typeof CHUNK_TYPE.ERROR; error: any }

type Chunk =
    | TextStart
    | TextDelta
    | TextComplete
    | ThinkingStart
    | ThinkingDelta
    | ThinkingComplete
    | CitationUpdate
    | ToolPending
    | ToolInProgress
    | ToolComplete
    | BlockComplete
    | ErrorChunk

// ChatSSE 结构：与现有后端协议对齐（只保留本适配器需要的字段）
interface ChatSSE<T = any> {
    answer: T
    isEnd: boolean
    status?: number
    docs?: any[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    node?: any
}

const TAG_RULES: Record<
    string,
    {
        name: 'think' | 'analysis' | 'tool'
        onStart?: ChunkType
        onDelta?: ChunkType
        onComplete?: ChunkType
    }
> = {
    think: {
        name: 'think',
        onStart: CHUNK_TYPE.THINKING_START,
        onDelta: CHUNK_TYPE.THINKING_DELTA,
        onComplete: CHUNK_TYPE.THINKING_COMPLETE
    },
    analysis: {
        name: 'analysis',
        onStart: CHUNK_TYPE.THINKING_START,
        onDelta: CHUNK_TYPE.THINKING_DELTA,
        onComplete: CHUNK_TYPE.THINKING_COMPLETE
    },
    tool: {
        name: 'tool',
        onStart: CHUNK_TYPE.TOOL_PENDING,
        onDelta: CHUNK_TYPE.TOOL_IN_PROGRESS,
        onComplete: CHUNK_TYPE.TOOL_COMPLETE
    }
}

const TAG_REGEX = /<(\/)?(think|analysis|tool)([^>]*)>/gi

function parseAttrs(attrStr: string): Record<string, string> {
    const attrs: Record<string, string> = {}
    const re = /(\w+)=\"([^\"]*)\"|(\w+)=\'([^\']*)\'/g
    let m: RegExpExecArray | null
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(attrStr))) {
        const key = (m[1] || m[3]) as string
        const val = (m[2] || m[4]) as string
        attrs[key] = val
    }
    return attrs
}

function cleanTags(input: string): string {
    return input?.replace(/<[^>]*>/g, '') || ''
}

function fillToolName(attrs: Record<string, string>, sse: ChatSSE<string>): void {
    if (attrs.name && attrs.name.trim()) return
    const fallback =
        attrs.tool ||
        attrs.id ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sse as any)?.toolName ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        sse.node?.name ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        sse.node?.toolName ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        sse.node?.id
    if (fallback) {
        attrs.name = String(fallback)
    }
}

type TagStackItem = { tag: string; attrs?: Record<string, string> }

function sseToChunks(params: {
    sse: ChatSSE<string>
    openStack: TagStackItem[]
    textStarted: boolean
}): { chunks: Chunk[]; newOpenStack: TagStackItem[]; textStarted: boolean } {
    const { sse } = params
    const chunks: Chunk[] = []
    let textStarted = params.textStarted
    let stack: TagStackItem[] = [...params.openStack]

    // 1) 引用更新
    if (sse.docs && sse.docs.length) {
        // 后端 docs 目前可能是对象数组，也可能是「JSON 字符串」数组，这里统一做一层解析与归一化
        const normalizeDoc = (d: any) => {
            let raw = d
            if (typeof d === 'string') {
                try {
                    raw = JSON.parse(d)
                } catch {
                    // 解析失败时兜底为纯字符串
                    return {
                        id: String(d),
                        title: String(d),
                        url: undefined,
                        extra: d
                    }
                }
            }
            return {
                id: raw.id || raw.file_id || raw.fileId || raw.kb_id || String(d),
                title:
                    raw.title ||
                    raw.fileName ||
                    raw.name ||
                    (typeof raw.snippet === 'string' ? raw.snippet.slice(0, 80) : '') ||
                    String(d),
                url: raw.url,
                // 把原始结构挂到 extra，方便前端拿 snippet 等字段
                extra: raw
            }
        }

        chunks.push({
            type: CHUNK_TYPE.CITATION_UPDATE,
            ts: Date.now(),
            docs: sse.docs.map((d: any) => normalizeDoc(d))
        })
    }

    const delta = String(sse.answer || '')
    if (!delta) {
        if (sse.isEnd) chunks.push({ type: CHUNK_TYPE.BLOCK_COMPLETE, ts: Date.now() })
        return { chunks, newOpenStack: stack, textStarted }
    }

    // 2) 标签解析（支持跨帧）
    let pos = 0
    let m: RegExpExecArray | null
    // eslint-disable-next-line no-cond-assign
    while ((m = TAG_REGEX.exec(delta))) {
        const closing = !!m[1]
        const tagName = (m[2] || '').toLowerCase()
        const attrStr = m[3] || ''
        const rule = TAG_RULES[tagName]
        const preceding = delta.slice(pos, m.index)

        if (preceding) {
            if (stack.length > 0) {
                const top = stack[stack.length - 1]
                const topRule = TAG_RULES[top.tag]
                if (topRule?.onDelta) {
                    if (top.tag === 'tool') {
                        chunks.push({
                            type: CHUNK_TYPE.TOOL_IN_PROGRESS,
                            ts: Date.now(),
                            name: top.attrs?.name || 'unknown',
                            data: preceding
                        })
                    } else {
                        chunks.push({
                            type: topRule.onDelta,
                            ts: Date.now(),
                            text: cleanTags(preceding)
                        } as any)
                    }
                }
            } else {
                // 纯正文
                if (!textStarted) {
                    chunks.push({ type: CHUNK_TYPE.TEXT_START, ts: Date.now() })
                    textStarted = true
                }
                const pure = cleanTags(preceding)
                if (pure) {
                    chunks.push({
                        type: CHUNK_TYPE.TEXT_DELTA,
                        ts: Date.now(),
                        text: pure
                    })
                }
            }
        }

        if (!closing) {
            // 开始标签
            if (rule) {
                const attrs = parseAttrs(attrStr)
                if (tagName === 'tool') {
                    fillToolName(attrs, sse)
                }
                // 如果此时不在任何标签内，且已经在输出正文段落，说明一个正文段结束，紧接着进入标签块：切断正文段
                if (stack.length === 0 && textStarted) {
                    chunks.push({
                        type: CHUNK_TYPE.TEXT_COMPLETE,
                        ts: Date.now(),
                        text: ''
                    })
                    textStarted = false
                }
                stack.push({ tag: tagName, attrs })
                if (rule.onStart) {
                    if (tagName === 'tool') {
                        chunks.push({
                            type: CHUNK_TYPE.TOOL_PENDING,
                            ts: Date.now(),
                            name: attrs.name || 'unknown'
                        })
                    } else {
                        chunks.push({
                            type: rule.onStart,
                            ts: Date.now()
                        } as any)
                    }
                }
            } else {
                // 未知标签，忽略但不入栈
            }
        } else {
            // 结束标签
            if (rule) {
                // 找到最近的相同标签并弹出
                for (let i = stack.length - 1; i >= 0; i--) {
                    if (stack[i].tag === tagName) {
                        const closed = stack[i]
                        stack = stack.slice(0, i)
                        if (rule.onComplete) {
                            if (tagName === 'tool') {
                                chunks.push({
                                    type: CHUNK_TYPE.TOOL_COMPLETE,
                                    ts: Date.now(),
                                    name: closed.attrs?.name || 'unknown'
                                })
                            } else {
                                chunks.push({
                                    type: rule.onComplete,
                                    ts: Date.now(),
                                    text: ''
                                } as any)
                            }
                        }
                        break
                    }
                }
            }
        }

        pos = m.index + m[0].length
    }

    // 3) 处理末尾残留
    const tail = delta.slice(pos)
    if (tail) {
        if (stack.length > 0) {
            const top = stack[stack.length - 1]
            const topRule = TAG_RULES[top.tag]
            if (topRule?.onDelta) {
                if (top.tag === 'tool') {
                    chunks.push({
                        type: CHUNK_TYPE.TOOL_IN_PROGRESS,
                        ts: Date.now(),
                        name: top.attrs?.name || 'unknown',
                        data: tail
                    })
                } else {
                    chunks.push({
                        type: topRule.onDelta,
                        ts: Date.now(),
                        text: cleanTags(tail)
                    } as any)
                }
            }
        } else {
            if (!textStarted) {
                chunks.push({ type: CHUNK_TYPE.TEXT_START, ts: Date.now() })
                textStarted = true
            }
            const pure = cleanTags(tail)
            if (pure) {
                chunks.push({
                    type: CHUNK_TYPE.TEXT_DELTA,
                    ts: Date.now(),
                    text: pure
                })
            }
        }
    }

    // 4) 结束信号
    if (sse.isEnd) {
        if (textStarted) {
            chunks.push({
                type: CHUNK_TYPE.TEXT_COMPLETE,
                ts: Date.now(),
                text: ''
            })
            textStarted = false
        }
        chunks.push({ type: CHUNK_TYPE.BLOCK_COMPLETE, ts: Date.now() })
        stack = []
        textStarted = false
    }

    return { chunks, newOpenStack: stack, textStarted }
}

// ===================== Block 事件类型 =====================

export type BlockEventType =
    | 'text-start'
    | 'text-delta'
    | 'text-complete'
    | 'thinking-start'
    | 'thinking-delta'
    | 'thinking-complete'
    | 'tool-pending'
    | 'tool-in-progress'
    | 'tool-complete'
    | 'citation-update'
    | 'block-complete'
    | 'error'

export type BlockStreamEvent = StreamEvent<BlockEventType, any, any>


type OpenBlockTag = 'text' | 'thinking' | 'tool'

const defaultGenBlockId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/**
 * 创建一次请求用的块解析器。
 * 块 id 在这里生成并写进事件，生命周期据此找到块，重复应用同一串事件结果一致。
 */
export function createBlocksParser(
    genBlockId: () => string = defaultGenBlockId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): (raw: any) => BlockStreamEvent[] {
    let openStack: TagStackItem[] = []
    let textStarted = false
    const openBlocks: Array<{ tag: OpenBlockTag; id: string }> = []

    const openBlock = (tag: OpenBlockTag) => {
        const id = genBlockId()
        openBlocks.push({ tag, id })
        return id
    }
    const peekBlock = (tag: OpenBlockTag) => {
        for (let i = openBlocks.length - 1; i >= 0; i--) {
            if (openBlocks[i].tag === tag) return openBlocks[i]
        }
        return undefined
    }
    const closeBlock = (tag: OpenBlockTag) => {
        for (let i = openBlocks.length - 1; i >= 0; i--) {
            if (openBlocks[i].tag === tag) return openBlocks.splice(i, 1)[0]
        }
        return undefined
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (raw: any) => {
        const timestamp = Date.now()
        const sse: ChatSSE<string> = {
            answer: String(raw?.answer ?? ''),
            isEnd: !!raw?.isEnd,
            status: raw?.status,
            docs: raw?.docs,
            node: raw?.node
        }
        const result = sseToChunks({ sse, openStack, textStarted })
        openStack = result.newOpenStack
        textStarted = result.textStarted

        const events: BlockStreamEvent[] = []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const push = (type: BlockEventType, payload: any) =>
            events.push({ type, payload, raw, timestamp })

        for (const chunk of result.chunks) {
            switch (chunk.type) {
                case CHUNK_TYPE.TEXT_START:
                    push('text-start', { blockId: openBlock('text') })
                    break
                case CHUNK_TYPE.TEXT_DELTA: {
                    let blockId = peekBlock('text')?.id
                    if (!blockId) {
                        // 没有打开中的正文块却来了增量：补开一个，保证增量有处可写
                        blockId = openBlock('text')
                        push('text-start', { blockId })
                    }
                    push('text-delta', { blockId, text: (chunk as TextDelta).text })
                    break
                }
                case CHUNK_TYPE.TEXT_COMPLETE: {
                    const block = closeBlock('text')
                    if (block) {
                        push('text-complete', {
                            blockId: block.id,
                            text: (chunk as TextComplete).text
                        })
                    }
                    break
                }
                case CHUNK_TYPE.THINKING_START:
                    push('thinking-start', { blockId: openBlock('thinking') })
                    break
                case CHUNK_TYPE.THINKING_DELTA: {
                    const block = peekBlock('thinking')
                    if (block) {
                        push('thinking-delta', {
                            blockId: block.id,
                            text: (chunk as ThinkingDelta).text
                        })
                    }
                    break
                }
                case CHUNK_TYPE.THINKING_COMPLETE:
                    push('thinking-complete', {
                        blockId: closeBlock('thinking')?.id,
                        text: (chunk as ThinkingComplete).text,
                        thinking_ms: (chunk as ThinkingComplete).thinking_ms
                    })
                    break
                case CHUNK_TYPE.TOOL_PENDING:
                    push('tool-pending', {
                        blockId: openBlock('tool'),
                        name: (chunk as ToolPending).name
                    })
                    break
                case CHUNK_TYPE.TOOL_IN_PROGRESS: {
                    const block = peekBlock('tool')
                    if (block) {
                        push('tool-in-progress', {
                            blockId: block.id,
                            name: (chunk as ToolInProgress).name,
                            data: (chunk as ToolInProgress).data
                        })
                    }
                    break
                }
                case CHUNK_TYPE.TOOL_COMPLETE:
                    push('tool-complete', {
                        blockId: closeBlock('tool')?.id,
                        name: (chunk as ToolComplete).name,
                        data: (chunk as ToolComplete).data
                    })
                    break
                case CHUNK_TYPE.CITATION_UPDATE:
                    push('citation-update', { docs: (chunk as CitationUpdate).docs })
                    break
                case CHUNK_TYPE.BLOCK_COMPLETE:
                    openBlocks.length = 0
                    push('block-complete', {})
                    break
                case CHUNK_TYPE.ERROR:
                    push('error', { error: (chunk as ErrorChunk).error })
                    break
            }
        }
        return events
    }
}
