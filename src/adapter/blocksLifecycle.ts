import type { Block, BlockMessage, MessageLifecycle, StreamEvent } from '../types'
import { createBlocksParser } from './blocksProtocol'

const findTarget = (draft: BlockMessage[], messageId: string) =>
    draft.find((message) => message.id === messageId)

const findBlock = (message: BlockMessage, blockId: string | undefined) =>
    blockId ? message.blocks?.find((block) => block.id === blockId) : undefined

const newBlock = (
    id: string,
    type: string,
    timestamp: number,
    extra: Partial<Block> = {}
): Block => ({
    id,
    type,
    content: '',
    status: 'streaming',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...extra
})

/**
 * 把一个块事件应用到目标消息上。
 * 只依赖 message 与 event：块 id 来自事件，时间来自 event.timestamp，
 * 重复应用同一串事件得到同样的结果。
 */
export function applyBlockEvent(target: BlockMessage, event: StreamEvent): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = (event.payload ?? {}) as any
    const ts = event.timestamp
    target.raw = event.raw
    target.blocks = target.blocks || []

    switch (event.type) {
        case 'text-start': {
            target.role = 'ai'
            target.process = target.process || []
            target.answer = target.answer || ''
            if (!findBlock(target, payload.blockId)) {
                target.blocks.push(newBlock(payload.blockId, 'mainText', ts))
            }
            break
        }
        case 'text-delta': {
            const text = String(payload.text ?? '')
            if (!text) break
            let block = findBlock(target, payload.blockId)
            if (!block) {
                block = newBlock(payload.blockId, 'mainText', ts)
                target.blocks.push(block)
            }
            block.content = (block.content || '') + text
            block.status = 'streaming'
            block.updatedAt = ts
            target.answer = (target.answer || '') + text
            target.content = (target.content || '') + text
            break
        }
        case 'text-complete': {
            const block = findBlock(target, payload.blockId)
            if (block) {
                block.status = 'success'
                block.updatedAt = ts
            }
            break
        }
        case 'thinking-start': {
            target.role = 'ai'
            target.isThinking = true
            target.process = target.process || []
            target.process.push({ name: 'think', loading: true, result: '', id: payload.blockId })
            if (!findBlock(target, payload.blockId)) {
                target.blocks.push(newBlock(payload.blockId, 'thinking', ts))
            }
            break
        }
        case 'thinking-delta': {
            const text = String(payload.text ?? '')
            const block = findBlock(target, payload.blockId)
            if (!text || !block) break
            block.content = (block.content || '') + text
            block.status = 'streaming'
            block.updatedAt = ts
            target.isThinking = true
            target.think = block.content
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const process = target.process?.find((item: any) => item.id === payload.blockId)
            if (process) process.result = block.content
            break
        }
        case 'thinking-complete': {
            const block = findBlock(target, payload.blockId)
            if (block) {
                block.status = 'success'
                block.updatedAt = ts
            }
            target.isThinking = false
            target.think = payload.text || target.think
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const process = target.process?.find((item: any) => item.id === payload.blockId)
            if (process) {
                process.loading = false
                process.result = String(process.result || '').replace(/<[^>]*>/g, '')
            }
            break
        }
        case 'citation-update': {
            const incomingDocs = payload.docs || []
            const allDocs = [...(Array.isArray(target.docs) ? target.docs : []), ...incomingDocs]
            target.docs = allDocs
            const block = target.blocks.find((item) => item.type === 'citation')
            if (block) {
                block.docs = allDocs
                block.status = 'success'
                block.updatedAt = ts
            } else {
                target.blocks.push(
                    newBlock(`${target.id}-citation`, 'citation', ts, {
                        status: 'success',
                        docs: allDocs
                    })
                )
            }
            break
        }
        case 'tool-pending': {
            const name = payload.name || 'unknown'
            target.process = target.process || []
            target.process.push({ name: 'tool', loading: true, result: name, id: payload.blockId })
            if (!findBlock(target, payload.blockId)) {
                target.blocks.push(newBlock(payload.blockId, 'tool', ts, { toolName: name }))
            }
            break
        }
        case 'tool-in-progress': {
            const data = payload.data
            const text = typeof data === 'string' ? data : data ? JSON.stringify(data) : ''
            const block = findBlock(target, payload.blockId)
            if (!text || !block) break
            block.content = (block.content || '') + text
            block.status = 'streaming'
            block.updatedAt = ts
            break
        }
        case 'tool-complete': {
            const block = findBlock(target, payload.blockId)
            if (block) {
                block.status = 'success'
                block.updatedAt = ts
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const process = target.process?.find((item: any) => item.id === payload.blockId)
            if (process) process.loading = false
            break
        }
        case 'block-complete': {
            finishStreamingBlocks(target, ts)
            break
        }
        case 'error': {
            // 这里仅记录错误标记，消息阶段由 controller 在收尾时统一写入
            target.error = payload.error || event.raw
            break
        }
        default:
            return
    }
    target.updatedAt = ts
}

/** 把还在输出的块、过程项都标记为结束 */
function finishStreamingBlocks(target: BlockMessage, timestamp: number) {
    for (const block of target.blocks || []) {
        if (block.status === 'streaming') {
            block.status = 'success'
            block.updatedAt = timestamp
        }
    }
    target.isThinking = false
    for (const item of target.process || []) {
        if (item?.loading) item.loading = false
    }
}

/**
 * 块风格的消息生命周期。
 * useExternalMessages 为 true 时，占位消息由调用方插入，并通过 send 的 messageId 指定写入目标。
 */
export function createBlocksLifecycle<TExtra = any>(
    options: {
        useExternalMessages?: boolean
        /** 自定义解析：传了就用它代替默认块协议解析（每次请求共用同一个函数） */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parseEvent?: (raw: any) => StreamEvent[]
    } = {}
): MessageLifecycle<BlockMessage, TExtra> {
    const { useExternalMessages = false, parseEvent } = options
    return {
        createParser: () => parseEvent ?? createBlocksParser(),
        onBeforeSend: (draft, ctx) => {
            if (useExternalMessages) return
            const now = Date.now()
            draft.push({
                id: `${ctx.messageId}-user`,
                role: 'user',
                content: ctx.question,
                createdAt: now,
                updatedAt: now
            } as BlockMessage)
            draft.push({
                id: ctx.messageId,
                role: 'ai',
                content: '',
                createdAt: now,
                updatedAt: now,
                blocks: []
            } as BlockMessage)
        },
        onStreamEvent: (draft, event, ctx) => {
            const target = findTarget(draft, ctx.messageId)
            if (target) applyBlockEvent(target, event)
        },
        onFinalize: (draft, _outcome, ctx) => {
            const target = findTarget(draft, ctx.messageId)
            if (!target) return
            // 没收到任何正文就结束（出错、取消）时，占位消息还是 loading 角色，转成 ai 才能展示结果
            if (target.role === 'loading') target.role = 'ai'
            target.blocks = target.blocks || []
            finishStreamingBlocks(target, Date.now())
        },
        onClear: (draft) => {
            if (draft.length <= 1) return
            const first = draft[0]
            draft.length = 0
            draft.push(first)
        }
    }
}
