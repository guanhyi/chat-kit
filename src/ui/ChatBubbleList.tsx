import React, { useEffect, useLayoutEffect, useRef } from 'react'
import { useOverlayScrollbars } from 'overlayscrollbars-react'
import { VList } from 'virtua'
import type { VListHandle } from 'virtua'
import type { ChatBubbleListProps, ChatBubbleListRef, BaseMessage } from '../types'
import { MessageRow } from './MessageRow'
import { useAutoScroll } from './useAutoScroll'

type ChatBubbleListComponent = <TMessage extends BaseMessage = BaseMessage>(
    props: ChatBubbleListProps<TMessage> & React.RefAttributes<ChatBubbleListRef>
) => React.ReactElement | null

const CHAT_VIRTUAL_BUFFER_SIZE = 2400

function isStreamingMessage(message: BaseMessage | undefined): boolean {
    if (!message) return false
    if (message.loading) return true
    if (message.role === 'loading') return true
    const blocks = message.blocks
    return Array.isArray(blocks) && blocks.some((block) => block?.status === 'streaming')
}

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
        scrollbarVisible = true,
        className,
        style,
        container,
        onScroll,
        bubbleClassName = 'max-w-[820px] min-w-0 w-full py-[30px] px-[10px] mx-auto relative'
    } = props

    const rootRef = useRef<HTMLDivElement | null>(null)
    const vListRef = useRef<VListHandle | null>(null)
    const layoutFrameRef = useRef<number | null>(null)
    const layoutDirtyRef = useRef(false)
    const onScrollRef = useRef(onScroll)
    const [layoutTick, setLayoutTick] = React.useState(0)

    onScrollRef.current = onScroll

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
                visibility: scrollbarVisible ? 'auto' : 'hidden',
                autoHide: 'leave',
                autoHideDelay: 200
            },
            update: {
                elementEvents: [['img', 'load']]
            }
        }
    })

    const getScrollViewport = React.useCallback((): HTMLElement | null => {
        const osInstance = instance()
        if (osInstance) {
            return osInstance.elements().viewport as HTMLElement
        }
        const root = rootRef.current
        const child = root?.firstElementChild
        if (child instanceof HTMLElement && child.scrollHeight > child.clientHeight) {
            return child
        }
        return root
    }, [instance])

    const emitScroll = React.useCallback(() => {
        const cb = onScrollRef.current
        if (!cb) return
        const viewport = getScrollViewport()
        cb(viewport?.scrollTop ?? vListRef.current?.scrollOffset ?? 0)
    }, [getScrollViewport])

    const autoScrollCtrl = useAutoScroll(
        getScrollViewport,
        // 第二个参数为哨兵 Ref，当前实现已不再依赖实际 DOM 哨兵，这里传入 undefined 占位。
        undefined,
        // 阈值目前仅作为预留配置，语义保持与 useCherryScroll 的 threshold 一致
        { threshold: 0.99 }
    )

    // 对外暴露 ref 能力：nativeElement / getViewport 实时读取，避免初始化时机问题
    React.useImperativeHandle(
        ref,
        (): ChatBubbleListRef => ({
            scrollToBottom: (behavior?: ScrollBehavior | 'instant') => {
                autoScrollCtrl.scrollToBottom(behavior || 'auto')
            },
            get nativeElement() {
                return getScrollViewport()
            },
            getViewport: getScrollViewport,
            vListRef
        }),
        [autoScrollCtrl, getScrollViewport]
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

    // 直接挂视口 scroll 监听，保证 onScroll 一定能收到（不依赖事件冒泡 / OS events 配置时机）
    useEffect(() => {
        if (!onScroll) return

        let disposed = false
        let viewport: HTMLElement | null = null
        let retryTimer: number | undefined
        let tries = 0

        const onViewportScroll = () => {
            emitScroll()
        }

        const tryAttach = () => {
            if (disposed) return
            viewport = getScrollViewport()
            if (!viewport) {
                if (tries < 40) {
                    tries += 1
                    retryTimer = window.setTimeout(tryAttach, 50)
                }
                return
            }
            viewport.addEventListener('scroll', onViewportScroll, { passive: true })
            emitScroll()
        }

        tryAttach()

        return () => {
            disposed = true
            if (retryTimer != null) {
                window.clearTimeout(retryTimer)
            }
            viewport?.removeEventListener('scroll', onViewportScroll)
        }
        // messages.length：历史消息灌入后 OS/布局可能重建，重新绑定更稳
    }, [emitScroll, getScrollViewport, messages.length, onScroll])

    // 初始化自动滚动监听
    useEffect(() => {
        if (!autoScroll) return
        const detach = autoScrollCtrl.attach()
        return () => {
            detach?.()
        }
    }, [autoScroll, autoScrollCtrl.attach])

    // 发送和流式长高都在绘制前贴底。useEffect 要等绘制后才滚，用户会先看到内容停在半截。
    // 发送当帧 OverlayScrollbars 可能还没绑上，直接写当前可滚动容器，不等 attach。
    useLayoutEffect(() => {
        if (!autoScroll || !autoScrollCtrl.isFollowing()) return
        const viewport = getScrollViewport()
        if (!viewport) return
        viewport.scrollTop = viewport.scrollHeight
    })

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
    }, [messages.length, autoScroll, autoScrollCtrl.maybeFollow])

    useEffect(() => {
        return () => {
            if (layoutFrameRef.current != null) {
                cancelAnimationFrame(layoutFrameRef.current)
            }
        }
    }, [])

    const handleMessageLayoutChange = React.useCallback(() => {
        // 拖选列表文字时不要为了贴底去 setState，避免 VList 重渲染拆掉原生选区
        const selection = document.getSelection()
        const root = rootRef.current
        if (
            selection &&
            !selection.isCollapsed &&
            root &&
            ((selection.anchorNode && root.contains(selection.anchorNode)) ||
                (selection.focusNode && root.contains(selection.focusNode)))
        ) {
            return
        }
        layoutDirtyRef.current = true
        if (layoutFrameRef.current != null) {
            return
        }
        layoutFrameRef.current = requestAnimationFrame(() => {
            layoutFrameRef.current = null
            if (!layoutDirtyRef.current) {
                return
            }
            layoutDirtyRef.current = false
            setLayoutTick((tick) => tick + 1)
        })
    }, [])

    useEffect(() => {
        if (!autoScroll) {
            return
        }
        autoScrollCtrl.maybeFollow()
    }, [layoutTick, autoScroll, autoScrollCtrl.maybeFollow])

    // 正在长的最后一条不进 VList。虚拟行先长高、下一帧才改 scrollTop，轮尾会跳。
    // 它结束后再收进虚拟列表。滚动恢复只针对 VList，tail 高度不参与那次计算。
    const liveIndex = messages.length - 1
    const liveMessage = messages[liveIndex]
    const hasLiveTail = isStreamingMessage(liveMessage)
    const virtualMessages = hasLiveTail ? messages.slice(0, liveIndex) : messages

    const renderMessage = (message: BaseMessage, index: number) => {
        const roleConfig = roles[message.role]
        if (!roleConfig) return null
        const placement = roleConfig.placement || 'start'
        const alignClass =
            placement === 'end' ? 'flex w-full min-w-0 justify-end ' : 'flex w-full min-w-0'
        const messageKey = String(message.id ?? index)
        return (
            <MessageRow
                key={messageKey}
                messageKey={messageKey}
                className={alignClass + ' ' + (bubbleClassName || '')}
                onLayoutChange={handleMessageLayoutChange}
            >
                {roleConfig.render({ message, index })}
            </MessageRow>
        )
    }

    const content = (
        <VList
            ref={vListRef}
            bufferSize={CHAT_VIRTUAL_BUFFER_SIZE}
            style={{ height: '100%', width: '100%' }}
            onScroll={emitScroll}
        >
            {virtualMessages.map((message, index) => renderMessage(message, index))}
            {hasLiveTail ? renderMessage(liveMessage as BaseMessage, liveIndex) : null}
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
