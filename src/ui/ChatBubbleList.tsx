import React, { useEffect, useRef } from 'react'
import { useOverlayScrollbars } from 'overlayscrollbars-react'
import { VList } from 'virtua'
import type { VListHandle } from 'virtua'
import type { ChatBubbleListProps, ChatBubbleListRef, BaseMessage } from '../types'
import { useAutoScroll } from './useAutoScroll'

type ChatBubbleListComponent = <TMessage extends BaseMessage = BaseMessage>(
    props: ChatBubbleListProps<TMessage> & React.RefAttributes<ChatBubbleListRef>
) => React.ReactElement | null

const CHAT_VIRTUAL_BUFFER_SIZE = 2400

/**
 * 基础气泡列表组件：
 * - 通过 roles 映射不同 role 的渲染方式；
 * - 内置自动滚动能力；
 * - 不依赖项目内的任何 UI 库，方便跨项目复用。
 *
 * 这一版本回到「VList + OverlayScrollbars + 哨兵在 VList 内」的结构，
 * 保持与最初接入时一致的 DOM 形态，避免样式与布局被破坏。
 */
const ChatBubbleListInner = (
    props: ChatBubbleListProps<BaseMessage>,
    ref: React.Ref<ChatBubbleListRef>
) => {
    const {
        messages,
        roles,
        autoScroll = true,
        safeBottom = 0,
        className,
        style,
        container,
        bubbleClassName = 'max-w-[820px]   py-[30px] px-[10px]  mx-auto relative'
    } = props

    const rootRef = useRef<HTMLDivElement | null>(null)
    const vListRef = useRef<VListHandle | null>(null)

    const [initialize, instance] = useOverlayScrollbars({
        defer: true,
        events: {
            initialized(osInstance) {
                const { viewport } = osInstance.elements()
                viewport.style.overflowX = `var(--os-viewport-scroll-x)`
                viewport.style.overflowY = `var(--os-viewport-scroll-y)`
            }
        },
        options: {
            scrollbars: {
                autoHide: 'leave',
                autoHideDelay: 200
            },
            update: {
                elementEvents: [
                    ['img', 'load'],
                    ['*', 'transitionstart transitionend']
                ]
            }
        }
    })

    const autoScrollCtrl = useAutoScroll(
        () => {
            const osInstance = instance()
            if (osInstance) {
                return osInstance.elements().viewport as HTMLElement
            }
            return rootRef.current
        },
        // 第二个参数为哨兵 Ref，当前实现已不再依赖实际 DOM 哨兵，这里传入 undefined 占位。
        undefined,
        // 阈值目前仅作为预留配置，语义保持与 useCherryScroll 的 threshold 一致
        { threshold: 0.99 }
    )

    // 对外暴露 ref 能力
    React.useImperativeHandle(
        ref,
        (): ChatBubbleListRef => ({
            scrollToBottom: (behavior?: ScrollBehavior | 'instant') => {
                autoScrollCtrl.scrollToBottom(behavior || 'auto')
            },
            nativeElement: (() => {
                const osInstance = instance()
                if (osInstance) {
                    return osInstance.elements().viewport as HTMLElement
                }
                return rootRef.current
            })(),
            vListRef
        }),
        [autoScrollCtrl, instance]
    )

    // 初始化 OverlayScrollbars：以内部 VList 容器作为 viewport
    useEffect(() => {
        const root = rootRef.current
        if (root && root.firstElementChild) {
            initialize({
                target: root,
                elements: {
                    viewport: root.firstElementChild as HTMLElement
                }
            })
        }
    }, [initialize])

    // 初始化自动滚动监听
    useEffect(() => {
        if (!autoScroll) return
        const detach = autoScrollCtrl.attach()
        return () => {
            detach?.()
        }
    }, [autoScroll, autoScrollCtrl])

    // 消息变更时尝试跟随：只在消息数量增加时触发，避免纯状态更新也强制贴底
    const prevLenRef = useRef<number>(messages.length)
    useEffect(() => {
        if (!autoScroll) {
            prevLenRef.current = messages.length
            return
        }
        const prevLen = prevLenRef.current
        prevLenRef.current = messages.length
        if (messages.length > prevLen) {
            autoScrollCtrl.maybeFollow()
        }
    }, [messages.length, autoScroll, autoScrollCtrl])

    const content = (
        <VList
            ref={vListRef}
            bufferSize={CHAT_VIRTUAL_BUFFER_SIZE}
            style={{ height: '100%', width: '100%' }}
        >
            {messages.map((m, index) => {
                const roleConfig = roles[m.role]
                if (!roleConfig) return null
                const placement = roleConfig.placement || 'start'
                const alignClass = placement === 'end' ? 'flex w-full justify-end ' : 'flex w-full'
                return (
                    <div key={m.id || index} className={alignClass + ' ' + (bubbleClassName || '')}>
                        {roleConfig.render({ message: m, index })}
                    </div>
                )
            })}
            {/* 安全底部间距，避免输入框遮挡 */}
            {safeBottom > 0 && <div style={{ height: safeBottom }} />}
        </VList>
    )

    const wrapped = container ? container(content) : content

    return (
        <div
            ref={rootRef}
            className={
                (className || '') + ' overflow-y-auto min-h-0 flex flex-col flex-1  relative'
            }
            style={{
                overflowAnchor: 'none',
                ...style
            }}
        >
            {wrapped}
        </div>
    )
}

export const ChatBubbleList = React.forwardRef(ChatBubbleListInner) as ChatBubbleListComponent

export default ChatBubbleList
