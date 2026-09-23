import { useCallback, useMemo } from 'react'
import type {
    BlockMessage,
    ChatSendOptions,
    UseBlocksChatAdapterOptions,
    UseBlocksChatAdapterResult
} from '../types'
import { useChatController } from '../controller/useChatController'
import { createBlocksLifecycle } from './blocksLifecycle'

export { applyBlockEvent, createBlocksLifecycle } from './blocksLifecycle'
export { createBlocksParser } from './blocksProtocol'
export type { BlockEventType, BlockStreamEvent } from './blocksProtocol'

// ===================== 适配器 Hook =====================

export const useBlocksChatAdapter = <TExtra = any>(
    options: UseBlocksChatAdapterOptions<TExtra>
): UseBlocksChatAdapterResult<TExtra> => {
    const { initialMessages, roles, useExternalMessages, parseEvent, ...rest } = options

    const messageLifecycle = useMemo(
        () => createBlocksLifecycle<TExtra>({ useExternalMessages, parseEvent }),
        [useExternalMessages, parseEvent]
    )

    const controller = useChatController<BlockMessage, TExtra>({
        ...rest,
        initialMessages,
        messageLifecycle
    })

    const { send } = controller
    const sendMessage = useCallback(
        (question: string, extra?: TExtra, sendOptions?: ChatSendOptions) =>
            send({ question, extra }, sendOptions),
        [send]
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
