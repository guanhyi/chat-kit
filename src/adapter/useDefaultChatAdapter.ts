import React, { useCallback, useMemo } from 'react'
import type {
    BaseMessage,
    ChatSendInput,
    ChatSendOptions,
    MessageLifecycle,
    UseChatControllerOptions,
    UseDefaultChatAdapterOptions,
    UseDefaultChatAdapterResult
} from '../types'
import { useChatController } from '../controller/useChatController'
import { ChatBubbleList } from '../ui/ChatBubbleList'

/**
 * 默认适配器：
 * - 基于 useChatController 提供一套现成的「messages + ChatBubbleList」组合；
 * - 内部使用默认生命周期（或调用方自定义的 lifecycle）管理 USER/AI 消息；
 * - 不写死业务字段，所有额外字段通过 extra 传递。
 */
export const useDefaultChatAdapter = <
    TMessage extends BaseMessage = BaseMessage,
    TExtra = any
>(
    options: UseDefaultChatAdapterOptions<TMessage, TExtra>
): UseDefaultChatAdapterResult<TMessage, TExtra> => {
    const { roles, ...controllerOptions } = options

    // 如果调用方没有传 messageLifecycle，则沿用 useChatController 内置默认实现
    const finalOptions: UseChatControllerOptions<TMessage, TExtra> = useMemo(
        () => controllerOptions,
        [controllerOptions]
    )

    const controller = useChatController<TMessage, TExtra>(finalOptions)

    const sendMessage = useCallback(
        (question: string, extra?: TExtra, sendOptions?: ChatSendOptions) => {
            const input: ChatSendInput<TExtra> = { question, extra }
            return controller.send(input, sendOptions)
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

// 方便直接使用组件形式：<DefaultChatBubbleList adapter={adapter} />
export const DefaultChatBubbleList = <
    TMessage extends BaseMessage = BaseMessage,
    TExtra = any
>(
    props: {
        adapter: UseDefaultChatAdapterResult<TMessage, TExtra>
    }
): React.ReactElement | null => {
    const { adapter } = props
    // 这里不用 JSX，保持在 .ts 文件中也能正常编译
    return React.createElement(ChatBubbleList as any, adapter.listProps)
}

export default useDefaultChatAdapter
