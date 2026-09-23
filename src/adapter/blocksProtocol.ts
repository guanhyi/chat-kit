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
    // 原始帧。后端把工具名放在顶层字段时只能从这里取，不能只留上面几个字段
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    raw?: any
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
const TAG_NAMES = ['think', 'analysis', 'tool']

// 后端不同版本用过 name / toolName / tool 等写法，按优先级依次尝试
const TOOL_NAME_ATTR_KEYS = ['name', 'toolname', 'tool_name', 'tool', 'type', 'id']

/**
 * 解析标签属性。双引号、单引号、不加引号三种写法都接受；
 * 属性名归一化到小写，`toolName` 与 `tool_name` 因此落到同一个键上。
 */
export function parseTagAttrs(attrStr: string): Record<string, string> {
    const attrs: Record<string, string> = {}
    const re = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
    let m: RegExpExecArray | null
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(attrStr))) {
        const val = m[2] ?? m[3] ?? m[4]
        if (val !== undefined) attrs[m[1].toLowerCase()] = val
    }
    return attrs
}

function cleanTags(input: string): string {
    return input?.replace(/<[^>]*>/g, '') || ''
}

/**
 * 取工具名：先看标签属性，再看这条 SSE 的顶层字段与 node。
 * 取不到时返回空串——数据层不伪造 'unknown'，怎么显示交给展示层。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveToolName(attrs: Record<string, string>, raw?: any): string {
    for (const key of TOOL_NAME_ATTR_KEYS) {
        const val = attrs[key]
        if (val && val.trim()) return val.trim()
    }
    const candidates = [
        raw?.toolName,
        raw?.tool_name,
        raw?.name,
        raw?.tool,
        raw?.node?.name,
        raw?.node?.toolName,
        raw?.node?.tool_name,
        raw?.node?.id
    ]
    for (const val of candidates) {
        if (typeof val === 'string' && val.trim()) return val.trim()
    }
    return ''
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fillToolName(attrs: Record<string, string>, raw?: any): void {
    if (attrs.name && attrs.name.trim()) return
    const name = resolveToolName(attrs, raw)
    if (name) attrs.name = name
}

/**
 * 找帧尾那半个还没闭合的标签，返回需要留到下一帧的下标；没有则返回 -1。
 * 判定刻意保守：只有看起来确实像已知标签开头（`<` / `</` / `<t` / `<tool …`）才留，
 * 正文里的 `a < b`、`<toolx` 都不会被扣下。
 */
function findTrailingPartialTag(delta: string): number {
    const start = delta.lastIndexOf('<')
    // 没有 '<'，或最后一个 '<' 后面还有 '>'，说明标签是完整的
    if (start < 0 || delta.indexOf('>', start) >= 0) return -1

    const body = delta.slice(start + 1).replace(/^\//, '')
    const letters = /^[a-zA-Z]*/.exec(body)?.[0] ?? ''
    if (!letters && body !== '') return -1
    if (letters && !TAG_NAMES.some((tag) => tag.startsWith(letters.toLowerCase()))) return -1

    return start
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

    // 名字可能比开标签到得晚（例如 node 在下一帧才带上来），所以每次要用时再尝试回填一次
    const toolNameOf = (item: TagStackItem): string => {
        if (item.attrs) fillToolName(item.attrs, sse.raw)
        return item.attrs?.name || ''
    }

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
                            name: toolNameOf(top),
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
                const attrs = parseTagAttrs(attrStr)
                if (tagName === 'tool') {
                    fillToolName(attrs, sse.raw)
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
                            name: attrs.name || ''
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
                                    name: toolNameOf(closed)
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
                        name: toolNameOf(top),
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
    // 帧尾那半个没闭合的标签，留到下一帧再拼
    let carry = ''
    const openBlocks: Array<{ tag: OpenBlockTag; id: string }> = []
    const warnedToolTags = new Set<string>()

    // 名字解析不出来时把原始标签打出来：下次真出现「已调用工具」时，
    // 控制台里直接能看到后端到底发的什么，不用再猜。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const warnMissingToolName = (delta: string, raw: any) => {
        const tag = /<tool[^>]*>/i.exec(delta)?.[0] ?? '<tool>'
        if (warnedToolTags.has(tag)) return
        warnedToolTags.add(tag)
        console.warn('chat-kit: 未能从工具标签解析出名字，已按空名处理。原始标签:', tag, {
            node: raw?.node,
            toolName: raw?.toolName ?? raw?.tool_name ?? raw?.name
        })
    }

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
        const isEnd = !!raw?.isEnd
        // 上一帧没打完的半个标签拼回本帧，否则 `<tool na` 会被当成正文漏出去
        const delta = carry + String(raw?.answer ?? '')
        // 最后帧不再保留：宁可把残留吐出来，也不要在流结束时静默吞掉内容
        const holdFrom = isEnd ? -1 : findTrailingPartialTag(delta)
        carry = holdFrom >= 0 ? delta.slice(holdFrom) : ''

        const sse: ChatSSE<string> = {
            answer: holdFrom >= 0 ? delta.slice(0, holdFrom) : delta,
            isEnd,
            status: raw?.status,
            docs: raw?.docs,
            node: raw?.node,
            raw
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
                case CHUNK_TYPE.TOOL_PENDING: {
                    const name = (chunk as ToolPending).name
                    if (!name) warnMissingToolName(delta, raw)
                    push('tool-pending', {
                        blockId: openBlock('tool'),
                        name
                    })
                    break
                }
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
