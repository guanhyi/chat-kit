import React, { useEffect, useLayoutEffect, useRef } from 'react'
import { useOverlayScrollbars } from 'overlayscrollbars-react'
import { Virtualizer } from 'virtua'
import type { VListHandle } from 'virtua'
import type { ChatBubbleListProps, ChatBubbleListRef, BaseMessage } from '../types'
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
 * 滚动结构：OverlayScrollbars 包住自持的滚动容器 scrollRef，Virtualizer 和流式尾条
 * 都在这个容器里。贴底规则见 useAutoScroll / scrollAnchor。
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
        onFollowChange,
        bubbleClassName = 'max-w-[820px] min-w-0 w-full py-[30px] px-[10px] mx-auto relative'
    } = props

    const rootRef = useRef<HTMLDivElement | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const contentRef = useRef<HTMLDivElement | null>(null)
    const vListRef = useRef<VListHandle | null>(null)
    const onScrollRef = useRef(onScroll)
    const onFollowChangeRef = useRef(onFollowChange)

    onScrollRef.current = onScroll
    onFollowChangeRef.current = onFollowChange

    const [initialize] = useOverlayScrollbars({
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

    // OverlayScrollbars 直接把 scrollRef 当 viewport，不会替换它，初始化前后都读这一个元素
    const getScrollViewport = React.useCallback((): HTMLElement | null => scrollRef.current, [])
    const getContentElement = React.useCallback((): HTMLElement | null => contentRef.current, [])

    const emitScroll = React.useCallback(() => {
        const cb = onScrollRef.current
        if (!cb) return
        const viewport = getScrollViewport()
        cb(viewport?.scrollTop ?? vListRef.current?.scrollOffset ?? 0)
    }, [getScrollViewport])

    const autoScrollCtrl = useAutoScroll(getScrollViewport, undefined, { getContentElement })

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

    // OverlayScrollbars 始终包住同一个滚动容器。Virtualizer 通过 scrollRef 使用它，
    // 流式消息是 Virtualizer 的兄弟，不另开滚动层。
    useEffect(() => {
        const root = rootRef.current
        const viewport = scrollRef.current
        if (root && viewport) {
            initialize({
                target: root,
                elements: { viewport }
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

    useEffect(() => {
        onFollowChangeRef.current?.(autoScrollCtrl.follow)
    }, [autoScrollCtrl.follow])

    // 贴底入口一：消息提交（发送、流式 delta）后在绘制前对账并贴底。
    // 入口二是 useAutoScroll 里的 ResizeObserver，接住虚拟行测高、图片加载这类不经过 React 提交的长高。
    useLayoutEffect(() => {
        if (!autoScroll) return
        autoScrollCtrl.maybeFollow()
    }, [messages, safeBottom, autoScroll, autoScrollCtrl.maybeFollow])

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
            <div
                key={messageKey}
                className={alignClass + ' ' + (bubbleClassName || '')}
                style={{ minWidth: 0, width: '100%' }}
            >
                {roleConfig.render({ message, index })}
            </div>
        )
    }

    const content = (
        <div ref={scrollRef} className="h-full w-full" style={{ overflowY: 'auto', height: '100%' }}>
            <div ref={contentRef} className="flex w-full flex-col items-center">
                <Virtualizer
                    ref={vListRef}
                    scrollRef={scrollRef}
                    bufferSize={CHAT_VIRTUAL_BUFFER_SIZE}
                    onScroll={emitScroll}
                >
                    {virtualMessages.map((message, index) => renderMessage(message, index))}
                </Virtualizer>
                {hasLiveTail ? renderMessage(liveMessage as BaseMessage, liveIndex) : null}
                {safeBottom > 0 && <div style={{ height: safeBottom }} />}
            </div>
        </div>
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
