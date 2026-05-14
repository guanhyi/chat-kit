import { useCallback, useMemo, useRef } from 'react'
import type {
    Block,
    BlockMessage,
    ChatSendInput,
    StreamEvent,
    UseBlocksChatAdapterOptions,
    UseBlocksChatAdapterResult
} from '../types'
import { useChatController } from '../controller/useChatController'
import type { MessageLifecycle } from '../types'

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

type BlockEventType =
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

type BlockStreamEvent = StreamEvent<BlockEventType, any, any>

// ChatSSE -> Chunk[] -> BlockStreamEvent[]
function createDefaultBlocksParser(
    openStackRef: React.MutableRefObject<TagStackItem[]>,
    textStartedRef: React.MutableRefObject<boolean>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): (raw: any) => BlockStreamEvent[] {
    return (raw: any) => {
        const ts = Date.now()
        const sse: ChatSSE<string> = {
            answer: String(raw?.answer ?? ''),
            isEnd: !!raw?.isEnd,
            status: raw?.status,
            docs: raw?.docs,
            node: raw?.node
        }

        const { chunks, newOpenStack, textStarted } = sseToChunks({
            sse,
            openStack: openStackRef.current,
            textStarted: textStartedRef.current
        })

        openStackRef.current = newOpenStack
        textStartedRef.current = textStarted

        const events: BlockStreamEvent[] = []

        for (const c of chunks) {
            switch (c.type) {
                case CHUNK_TYPE.TEXT_START:
                    events.push({
                        type: 'text-start',
                        payload: {},
                        raw,
                        timestamp: ts
                    })
                    break
                case CHUNK_TYPE.TEXT_DELTA:
                    events.push({
                        type: 'text-delta',
                        payload: { text: (c as TextDelta).text },
                        raw,
                        timestamp: ts
                    })
                    break
                case CHUNK_TYPE.TEXT_COMPLETE:
                    events.push({
                        type: 'text-complete',
                        payload: { text: (c as TextComplete).text },
                        raw,
                        timestamp: ts
                    })
                    break
                case CHUNK_TYPE.THINKING_START:
                    events.push({
                        type: 'thinking-start',
                        payload: {},
                        raw,
                        timestamp: ts
                    })
                    break
                case CHUNK_TYPE.THINKING_DELTA:
                    events.push({
                        type: 'thinking-delta',
                        payload: { text: (c as ThinkingDelta).text },
                        raw,
                        timestamp: ts
                    })
                    break
                case CHUNK_TYPE.THINKING_COMPLETE:
                    events.push({
                        type: 'thinking-complete',
                        payload: {
                            text: (c as ThinkingComplete).text,
                            thinking_ms: (c as ThinkingComplete).thinking_ms
                        },
                        raw,
                        timestamp: ts
                    })
                    break
                case CHUNK_TYPE.CITATION_UPDATE:
                    events.push({
                        type: 'citation-update',
                        payload: { docs: (c as CitationUpdate).docs },
                        raw,
                        timestamp: ts
                    })
                    break
                case CHUNK_TYPE.TOOL_PENDING:
                    events.push({
                        type: 'tool-pending',
                        payload: { name: (c as ToolPending).name },
                        raw,
                        timestamp: ts
                    })
                    break
                case CHUNK_TYPE.TOOL_IN_PROGRESS:
                    events.push({
                        type: 'tool-in-progress',
                        payload: {
                            name: (c as ToolInProgress).name,
                            data: (c as ToolInProgress).data
                        },
                        raw,
                        timestamp: ts
                    })
                    break
                case CHUNK_TYPE.TOOL_COMPLETE:
                    events.push({
                        type: 'tool-complete',
                        payload: {
                            name: (c as ToolComplete).name,
                            data: (c as ToolComplete).data
                        },
                        raw,
                        timestamp: ts
                    })
                    break
                case CHUNK_TYPE.BLOCK_COMPLETE:
                    events.push({
                        type: 'block-complete',
                        payload: {},
                        raw,
                        timestamp: ts
                    })
                    break
                case CHUNK_TYPE.ERROR:
                    events.push({
                        type: 'error',
                        payload: { error: (c as ErrorChunk).error },
                        raw,
                        timestamp: ts
                    })
                    break
            }
        }

        return events
    }
}

// ===================== Block 生命周期 =====================

function createBlocksLifecycle<TExtra = any>(
    useExternalMessages = false
): MessageLifecycle<BlockMessage, TExtra> {
    const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const textBlockIdRef = { current: null as string | null }
    const thinkBlockIdRef = { current: null as string | null }
    const blockStackRef = {
        current: [] as Array<{ tag: 'text' | 'thinking' | 'tool'; id: string }>
    }

    const pushBlock = (tag: 'text' | 'thinking' | 'tool', id: string) => {
        blockStackRef.current.push({ tag, id })
    }

    const peekBlock = (tag?: 'text' | 'thinking' | 'tool') => {
        const stack = blockStackRef.current
        for (let i = stack.length - 1; i >= 0; i--) {
            if (!tag || stack[i].tag === tag) return stack[i]
        }
        return undefined
    }

    const popBlock = (tag?: 'text' | 'thinking' | 'tool') => {
        const stack = blockStackRef.current
        if (stack.length === 0) return undefined
        if (!tag) return stack.pop()
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].tag === tag) {
                const [item] = stack.splice(i, 1)
                return item
            }
        }
        return undefined
    }

    const resetBlockTracking = () => {
        textBlockIdRef.current = null
        thinkBlockIdRef.current = null
        blockStackRef.current = []
    }

    return {
        onBeforeSend: (draft, ctx) => {
            if (useExternalMessages) {
                // 外部（例如 ChatView）自己维护 user/loading 占位消息
                return
            }
            const idBase = Date.now().toString()
            draft.push({
                id: `${idBase}-user`,
                role: 'user',
                content: ctx.question,
                createdAt: Date.now(),
                updatedAt: Date.now()
            } as BlockMessage)
            draft.push({
                id: `${idBase}-ai`,
                role: 'ai',
                content: '',
                loading: true,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                blocks: []
            } as any)
        },
        onStreamEvent: (draft, event, ctx) => {
            const last = draft[draft.length - 1]
            // 允许外部先插入 loading 占位，然后在 text-start/thinking-start 中切换为 ai
            if (!last) return
            last.raw = event.raw
            last.blocks = last.blocks || []

            switch (event.type) {
                case 'text-start': {
                    last.role = 'ai'
                    ;(last as any).loading = true
                    last.process = last.process || []
                    last.answer = last.answer || ''
                    last.blocks = last.blocks || []
                    const id = genId()
                    textBlockIdRef.current = id
                    const block: Block = {
                        id,
                        type: 'mainText',
                        content: '',
                        status: 'streaming',
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    }
                    last.blocks.push(block)
                    pushBlock('text', id)
                    last.updatedAt = Date.now()
                    break
                }
                case 'text-delta': {
                    const text =
                        (event.payload as any)?.text ??
                        (event.raw as any)?.answer ??
                        (event.payload as any)?.delta ??
                        ''
                    if (!text) break
                    const textBlock = peekBlock('text')
                    const id = textBlock?.id || textBlockIdRef.current
                    let block = id
                        ? last.blocks.find((b) => b.id === id)
                        : last.blocks.find((b) => b.type === 'mainText')
                    if (!block) {
                        block = {
                            id: genId(),
                            type: 'mainText',
                            status: 'streaming',
                            content: '',
                            createdAt: Date.now(),
                            updatedAt: Date.now()
                        }
                        last.blocks.push(block)
                    }
                    block.content = (block.content || '') + String(text)
                    block.status = 'streaming'
                    block.updatedAt = Date.now()
                    last.answer = (last.answer || '') + String(text)
                    last.content = (last.content || '') + String(text)
                    last.updatedAt = Date.now()
                    break
                }
                case 'text-complete': {
                    const textBlock = popBlock('text')
                    const id = textBlock?.id || textBlockIdRef.current
                    let block = id
                        ? last.blocks.find((b) => b.id === id)
                        : last.blocks.find((b) => b.type === 'mainText')
                    if (block) {
                        block.status = 'success'
                        block.updatedAt = Date.now()
                    }
                    ;(last as any).loading = false
                    last.updatedAt = Date.now()
                    break
                }
                case 'thinking-start': {
                    last.role = 'ai'
                    last.isThinking = true
                    last.process = last.process || []
                    last.process.push({
                        name: 'think',
                        loading: true,
                        result: '',
                        id: Date.now().toString()
                    })
                    last.blocks = last.blocks || []
                    const id = genId()
                    thinkBlockIdRef.current = id
                    const block: Block = {
                        id,
                        type: 'thinking',
                        content: '',
                        status: 'streaming',
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    }
                    last.blocks.push(block)
                    pushBlock('thinking', id)
                    last.updatedAt = Date.now()
                    break
                }
                case 'thinking-delta': {
                    const text =
                        (event.payload as any)?.text ??
                        (event.raw as any)?.answer ??
                        (event.payload as any)?.delta ??
                        ''
                    if (!text) break
                    const thinkBlock = peekBlock('thinking')
                    const id = thinkBlock?.id || thinkBlockIdRef.current
                    if (id) {
                        const block = last.blocks.find((b) => b.id === id)
                        if (!block) break
                        block.content = (block.content || '') + String(text)
                        block.status = 'streaming'
                        block.updatedAt = Date.now()
                        last.isThinking = true
                        last.think = block.content
                        last.process = last.process || []
                        const p = last.process.find((x: any) => x.name === 'think' && x.loading)
                        if (p) p.result = block.content
                        last.updatedAt = Date.now()
                    }
                    break
                }
                case 'thinking-complete': {
                    const thinkBlock = popBlock('thinking')
                    const id = thinkBlock?.id || thinkBlockIdRef.current
                    if (id) {
                        const block = last.blocks.find((b) => b.id === id)
                        if (block) {
                            block.status = 'success'
                            block.updatedAt = Date.now()
                        }
                    }
                    const text = (event.payload as any)?.text ?? (event.raw as any)?.answer ?? ''
                    last.isThinking = false
                    last.think = text || last.think
                    if (last.process && last.process.length > 0) {
                        const p = last.process[last.process.length - 1]
                        if (p?.name === 'think') {
                            p.loading = false
                            p.result = (p.result || '').replace(/<[^>]*>/g, '')
                        }
                    }
                    last.updatedAt = Date.now()
                    break
                }
                case 'citation-update': {
                    const incomingDocs = (event.payload as any)?.docs || []
                    const prevDocs = Array.isArray(last.docs) ? last.docs : []
                    const allDocs = [...prevDocs, ...incomingDocs]
                    last.docs = allDocs
                    let block: Block | undefined = last.blocks.find((b) => b.type === 'citation')
                    if (!block) {
                        block = {
                            id: Date.now().toString(),
                            type: 'citation',
                            status: 'success',
                            docs: allDocs,
                            createdAt: Date.now(),
                            updatedAt: Date.now()
                        }
                        last.blocks.push(block)
                    } else {
                        block.docs = allDocs
                        block.status = 'success'
                        block.updatedAt = Date.now()
                    }
                    last.updatedAt = Date.now()
                    break
                }
                case 'tool-pending': {
                    const name = (event.payload as any)?.name || 'unknown'
                    last.process = last.process || []
                    last.process.push({
                        name: 'tool',
                        loading: true,
                        result: name || '',
                        id: Date.now().toString()
                    })
                    last.blocks = last.blocks || []
                    const id = genId()
                    const key = name || 'unknown'
                    const block: Block = {
                        id,
                        type: 'tool',
                        toolName: key,
                        content: '',
                        status: 'streaming',
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    }
                    last.blocks.push(block)
                    pushBlock('tool', id)
                    last.updatedAt = Date.now()
                    break
                }
                case 'tool-in-progress': {
                    const data = (event.payload as any)?.data
                    const text = typeof data === 'string' ? data : data ? JSON.stringify(data) : ''
                    const toolBlock = peekBlock('tool')
                    const id = toolBlock?.id
                    if (id && text) {
                        const block = last.blocks.find((b) => b.id === id)
                        if (block) {
                            block.content = (block.content || '') + text
                            block.status = 'streaming'
                            block.updatedAt = Date.now()
                        }
                        last.updatedAt = Date.now()
                    }
                    break
                }
                case 'tool-complete': {
                    console.log(
                        'tool-complete',
                        last.blocks.map((b) => ({
                            id: b.id,
                            type: b.type,
                            content: b.content?.slice(0, 20)
                        }))
                    )
                    const toolBlock = popBlock('tool')
                    const id = toolBlock?.id
                    if (id) {
                        const block = last.blocks.find((b) => b.id === id)
                        if (block) {
                            block.status = 'success'
                            block.updatedAt = Date.now()
                        }
                    }
                    if (last.process && last.process.length > 0) {
                        const p = last.process[last.process.length - 1]
                        if (p?.name === 'tool') p.loading = false
                    }
                    last.updatedAt = Date.now()
                    break
                }
                case 'block-complete': {
                    last.isEnd = true
                    ;(last as any).loading = false
                    last.updatedAt = Date.now()
                    // 将所有 streaming block 标记为 success
                    last.blocks.forEach((b) => {
                        if (b.status === 'streaming') {
                            b.status = 'success'
                            b.updatedAt = Date.now()
                        }
                    })
                    last.isThinking = false
                    resetBlockTracking()
                    break
                }
                case 'error': {
                    // 这里仅记录错误标记，具体跳转/提示由外层 onError 处理
                    ;(last as any).error = (event.payload as any)?.error || event.raw
                    last.updatedAt = Date.now()
                    break
                }
                default:
                    break
            }

            void ctx
        },
        onCancel: (draft) => {
            const last = draft[draft.length - 1]
            if (!last) return
            ;(last as any).loading = false
            last.isEnd = true
            last.isThinking = false
            last.updatedAt = Date.now()
        },
        onClear: (draft) => {
            if (draft.length <= 1) return
            const first = draft[0]
            draft.length = 0
            draft.push(first)
        }
    }
}

// ===================== 适配器 Hook =====================

export const useBlocksChatAdapter = <TExtra = any>(
    options: UseBlocksChatAdapterOptions<TExtra>
): UseBlocksChatAdapterResult<TExtra> => {
    const {
        httpClient,
        buildRequest,
        isFinal,
        parseEvent,
        onOpen,
        onError,
        onComplete,
        initialMessages,
        roles,
        useExternalMessages
    } = options

    const openStackRef = useRef<TagStackItem[]>([])
    const textStartedRef = useRef(false)

    const controller = useChatController<BlockMessage, TExtra>({
        httpClient,
        buildRequest,
        isFinal,
        // 使用我们自己的 parseEvent，把 raw JSON 转换为 BlockStreamEvent[]
        parseEvent: (raw) => {
            if (parseEvent) {
                return parseEvent(raw)
            }
            const interpret = createDefaultBlocksParser(openStackRef, textStartedRef)
            return interpret(raw)
        },
        onOpen: (body) => {
            // 每次新的请求重置块解析状态
            openStackRef.current = []
            textStartedRef.current = false
            onOpen?.(body)
        },
        onError,
        onComplete,
        initialMessages,
        messageLifecycle: createBlocksLifecycle<TExtra>(!!useExternalMessages)
    })

    const sendMessage = useCallback(
        (question: string, extra?: TExtra) => {
            const input: ChatSendInput<TExtra> = { question, extra }
            return controller.send(input)
        },
        [controller]
    )

    const listProps = useMemo(
        () => ({
            messages: controller.messages,
            roles,
            // 与历史聊天页面行为保持一致：始终挂载自动滚动逻辑，
            // 是否实际跟随由 useAutoScroll 内部的 follow 状态和用户滚动行为决定。
            autoScroll: true,
            safeBottom: 0,
            className: 'chat-kit-bubble-list'
        }),
        [controller.messages, roles]
    )

    return {
        listProps,
        controller,
        sendMessage
    }
}

export default useBlocksChatAdapter
