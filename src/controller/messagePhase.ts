import type { BaseMessage, MessagePhase } from '../types'

export const isInProgressPhase = (phase: MessagePhase | undefined): boolean =>
    phase === 'pending' || phase === 'streaming'

/**
 * 消息是否还在生成。有 phase 时只看 phase；
 * 没有 phase 的旧数据（未升级的调用方）退回旧字段判断。
 */
export function isMessageInProgress(message: BaseMessage | undefined | null): boolean {
    if (!message) return false
    if (message.phase) return isInProgressPhase(message.phase)
    if (message.loading) return true
    if (message.role === 'loading') return true
    const blocks = message.blocks
    return Array.isArray(blocks) && blocks.some((block) => block?.status === 'streaming')
}

/**
 * 写入消息阶段，并同步旧字段 loading / isEnd / isThinking。
 * 消息阶段的每一次变化都应该走这里，不要单独改旧字段。
 */
export function setMessagePhase(message: BaseMessage, phase: MessagePhase): void {
    const inProgress = isInProgressPhase(phase)
    message.phase = phase
    message.loading = inProgress
    message.isEnd = !inProgress
    if (!inProgress) message.isThinking = false
    if (phase !== 'error') delete message.errorText
}
