import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    BOTTOM_ANCHOR_EPSILON_PX,
    LAYOUT_SCROLL_GUARD_MS,
    USER_SCROLL_INTENT_TTL_MS,
    anchorActionAfterContentChange,
    classifyScrollSource,
    isAtBottom,
    keyboardScrollIntent,
    reconcileFollowingForContentAnchor,
    resolveFollowingAfterScroll,
    touchScrollIntent,
    wheelScrollIntent,
    type ScrollMetrics,
    type UserScrollIntent
} from './scrollAnchor'

type Options = {
    /** 离底判定容差，默认 48px */
    bottomEpsilonPx?: number
    /**
     * 内容根节点。它的尺寸变化（流式长高、虚拟行测高、图片加载）会触发贴底；
     * 缺省取 viewport 的第一个子元素。
     */
    getContentElement?: () => HTMLElement | null
}

/** smooth 回到底部期间的中间帧不算用户滚动 */
const SMOOTH_SCROLL_GUARD_MS = 800

const readMetrics = (viewport: HTMLElement): ScrollMetrics => ({
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.clientHeight,
    contentHeight: viewport.scrollHeight
})

const isEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false
    return (
        target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
    )
}

/** 原生滚动条命中 viewport 自身；OverlayScrollbars 的滚动条挂在包住 viewport 的宿主上 */
const isScrollbarTarget = (target: EventTarget | null, viewport: HTMLElement) => {
    if (target === viewport) return true
    if (!(target instanceof Element)) return false
    const scrollbar = target.closest('.os-scrollbar')
    return Boolean(scrollbar?.parentElement?.contains(viewport))
}

const isNonCollapsedSelectionInside = (root: HTMLElement) => {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return false
    }
    const anchor = selection.anchorNode
    const focus = selection.focusNode
    return Boolean(
        (anchor && root.contains(anchor)) || (focus && root.contains(focus))
    )
}

/**
 * 自动滚动 Hook，判定规则见 scrollAnchor.ts：
 * - following 表示用户的滚动权，只有真实用户输入（带方向的 wheel/touch/键盘、拖滚动条）能改变它；
 *   程序化贴底和虚拟列表测高补偿产生的 scroll 事件只记账；
 * - 内容区的普通点击（发送、展开块）不算滚动意图；
 * - 贴底只有两个入口：调用方在消息提交后的 layout effect 里调 maybeFollow，
 *   以及这里对内容根节点和 viewport 的 ResizeObserver；
 * - 列表内存在非空文字选区时暂停跟随，避免手机拖选时系统自动滚和贴底抢滚动。
 *
 * 第二个参数 sentinelRef 已不参与逻辑，仅为兼容旧调用签名保留。
 */
export function useAutoScroll(
    getViewport: () => HTMLElement | null,
    _sentinelRef?: RefObject<HTMLElement>,
    options: Options = {}
) {
    const epsilonPx = options.bottomEpsilonPx ?? BOTTOM_ANCHOR_EPSILON_PX
    const getContentElementRef = useRef(options.getContentElement)
    getContentElementRef.current = options.getContentElement

    // 跟随态放 ref，每帧读写不触发渲染；follow state 只给外部展示用
    const followingRef = useRef(true)
    const publishedFollowRef = useRef(true)
    const [follow, setFollowState] = useState(true)
    const lastObservedScrollTopRef = useRef(0)
    const programmaticFrameRef = useRef<number | null>(null)
    const smoothScrollUntilRef = useRef(0)
    const layoutGuardUntilRef = useRef(0)
    const userScrollIntentRef = useRef<{ intent: UserScrollIntent; observedAt: number }>({
        intent: 'none',
        observedAt: 0
    })
    const touchClientYRef = useRef<number | null>(null)
    const scrollbarPointerIdRef = useRef<number | null>(null)
    // 列表内正在拖选文字时锁定，阻止贴底把选区自动滚动拉回去
    const selectionLockRef = useRef(false)

    const commitFollowing = useCallback((next: boolean, silent = false) => {
        followingRef.current = next
        // silent 只改 ref：拖选时 setState 会重渲染 VList，原生选区会被拆掉
        if (silent || publishedFollowRef.current === next) return
        publishedFollowRef.current = next
        setFollowState(next)
    }, [])

    const getActiveUserScrollIntent = useCallback((): UserScrollIntent => {
        const current = userScrollIntentRef.current
        const interactionActive =
            touchClientYRef.current !== null || scrollbarPointerIdRef.current !== null
        if (interactionActive) {
            return current.intent === 'none' ? 'unknown' : current.intent
        }
        return Date.now() - current.observedAt <= USER_SCROLL_INTENT_TTL_MS
            ? current.intent
            : 'none'
    }, [])

    const clearUserScrollIntent = useCallback(() => {
        userScrollIntentRef.current = { intent: 'none', observedAt: 0 }
        touchClientYRef.current = null
        scrollbarPointerIdRef.current = null
    }, [])

    const markUserScrollIntent = useCallback(
        (intent: UserScrollIntent) => {
            if (intent === 'none') return
            userScrollIntentRef.current = { intent, observedAt: Date.now() }
            smoothScrollUntilRef.current = 0
            const viewport = getViewport()
            // 向上滚动必须在 scroll 事件之前先拿走滚动权，否则同帧的贴底会拿过期的
            // following=true 把用户拽回底部
            if (
                intent === 'awayFromBottom' &&
                viewport &&
                viewport.scrollHeight > viewport.clientHeight
            ) {
                commitFollowing(false, selectionLockRef.current)
            }
        },
        [getViewport, commitFollowing]
    )

    const markProgrammaticScroll = useCallback(() => {
        if (programmaticFrameRef.current !== null) {
            cancelAnimationFrame(programmaticFrameRef.current)
        }
        programmaticFrameRef.current = requestAnimationFrame(() => {
            programmaticFrameRef.current = null
        })
    }, [])

    // 贴底必须同步写 scrollTop：smooth 的中间帧会被当成离底，流式长高时也会晚一帧才到底
    const stickToBottom = useCallback(
        (viewport: HTMLElement) => {
            markProgrammaticScroll()
            viewport.scrollTop = viewport.scrollHeight
            // 浏览器会把赋值钳到最大可滚动距离，回读真实落点入账
            lastObservedScrollTopRef.current = viewport.scrollTop
        },
        [markProgrammaticScroll]
    )

    /** 内容变化（新消息 / 流式 delta / 测高修正）后调用：跟随中贴底，已解除则保持阅读位置 */
    const maybeFollow = useCallback(() => {
        if (selectionLockRef.current) return
        const viewport = getViewport()
        if (!viewport) return
        layoutGuardUntilRef.current = Date.now() + LAYOUT_SCROLL_GUARD_MS
        const following = reconcileFollowingForContentAnchor({
            following: followingRef.current,
            metrics: readMetrics(viewport),
            lastObservedScrollTop: lastObservedScrollTopRef.current,
            userScrollIntent: getActiveUserScrollIntent(),
            bottomEpsilonPx: epsilonPx
        })
        commitFollowing(following)
        if (anchorActionAfterContentChange(following) === 'stickToBottom') {
            stickToBottom(viewport)
        }
    }, [getViewport, getActiveUserScrollIntent, commitFollowing, stickToBottom, epsilonPx])

    /** 回到底部并恢复跟随：发送消息、打开会话、点「回到底部」都走这里 */
    const scrollToBottom = useCallback(
        (behavior: ScrollBehavior | 'instant' = 'instant') => {
            if (selectionLockRef.current) return
            const viewport = getViewport()
            if (!viewport) return
            clearUserScrollIntent()
            commitFollowing(true)
            if (behavior === 'smooth') {
                smoothScrollUntilRef.current = Date.now() + SMOOTH_SCROLL_GUARD_MS
                viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
                return
            }
            stickToBottom(viewport)
        },
        [getViewport, clearUserScrollIntent, commitFollowing, stickToBottom]
    )

    const attach = useCallback(() => {
        const viewport = getViewport()
        if (!viewport) return () => {}
        lastObservedScrollTopRef.current = viewport.scrollTop

        const lockSelection = () => {
            if (selectionLockRef.current) return
            selectionLockRef.current = true
            commitFollowing(false, true)
        }

        const unlockSelection = () => {
            if (!selectionLockRef.current) return
            selectionLockRef.current = false
            lastObservedScrollTopRef.current = viewport.scrollTop
            commitFollowing(isAtBottom(readMetrics(viewport), epsilonPx))
        }

        const syncSelectionLock = () => {
            if (isNonCollapsedSelectionInside(viewport)) {
                lockSelection()
                return
            }
            unlockSelection()
        }

        const onSelectStart = (event: Event) => {
            const target = event.target
            if (target instanceof Node && viewport.contains(target)) {
                lockSelection()
            }
        }

        const onWheel = (event: WheelEvent) => {
            markUserScrollIntent(wheelScrollIntent(event.deltaY))
        }

        const onTouchStart = (event: TouchEvent) => {
            touchClientYRef.current = event.touches[0]?.clientY ?? null
        }

        const onTouchMove = (event: TouchEvent) => {
            const nextClientY = event.touches[0]?.clientY
            const previousClientY = touchClientYRef.current
            if (nextClientY === undefined || previousClientY === null) return
            markUserScrollIntent(touchScrollIntent(previousClientY, nextClientY))
            touchClientYRef.current = nextClientY
        }

        // iOS 长按松手后选区才出现，补一次探测，避免手柄拖动开始时贴底还没锁上
        let selectionProbeTimer: number | null = null
        const onTouchEnd = () => {
            touchClientYRef.current = null
            if (selectionProbeTimer != null) window.clearTimeout(selectionProbeTimer)
            selectionProbeTimer = window.setTimeout(() => {
                selectionProbeTimer = null
                if (isNonCollapsedSelectionInside(viewport)) {
                    lockSelection()
                }
            }, 300)
        }

        const onKeyDown = (event: KeyboardEvent) => {
            // 焦点在列表内或落在 body（点过列表正文）时，方向键滚动的就是这个列表
            const target = event.target
            const inList =
                target === document.body ||
                target === document.documentElement ||
                (target instanceof Node && viewport.contains(target))
            if (!inList) return
            markUserScrollIntent(
                keyboardScrollIntent({
                    key: event.key,
                    shiftKey: event.shiftKey,
                    editableTarget: isEditableTarget(target)
                })
            )
        }

        // 内容区点击（尤其是发送、展开块）不是滚动意图；只有命中滚动条才登记未知方向，
        // 随后由真实 scroll 落点裁决
        const onPointerDown = (event: PointerEvent) => {
            if (!isScrollbarTarget(event.target, viewport)) return
            scrollbarPointerIdRef.current = event.pointerId
            markUserScrollIntent('unknown')
        }

        const onPointerEnd = (event: PointerEvent) => {
            if (scrollbarPointerIdRef.current === event.pointerId) {
                scrollbarPointerIdRef.current = null
            }
        }

        const onScroll = () => {
            const scrollTop = viewport.scrollTop
            if (selectionLockRef.current) {
                lastObservedScrollTopRef.current = scrollTop
                return
            }
            const now = Date.now()
            const programmatic =
                (programmaticFrameRef.current !== null &&
                    Math.abs(scrollTop - lastObservedScrollTopRef.current) < 1) ||
                now < smoothScrollUntilRef.current
            const source = classifyScrollSource({
                userScrollIntent: getActiveUserScrollIntent(),
                programmatic,
                withinLayoutGuard: now <= layoutGuardUntilRef.current
            })
            lastObservedScrollTopRef.current = scrollTop
            commitFollowing(
                resolveFollowingAfterScroll({
                    following: followingRef.current,
                    metrics: readMetrics(viewport),
                    source,
                    epsilonPx
                })
            )
        }

        // 不经过 React 提交的长高（虚拟行测高、图片/Mermaid 加载、输入框挤压 viewport）
        // 由 ResizeObserver 接住。回调在布局后、绘制前执行，贴底不会先闪一帧。
        let resizeObserver: ResizeObserver | null = null
        if (typeof ResizeObserver !== 'undefined') {
            const observedHeights = new Map<Element, number>()
            resizeObserver = new ResizeObserver((entries) => {
                let changed = false
                for (const entry of entries) {
                    const height = entry.contentRect.height
                    if (observedHeights.get(entry.target) !== height) {
                        observedHeights.set(entry.target, height)
                        changed = true
                    }
                }
                if (changed) maybeFollow()
            })
            resizeObserver.observe(viewport)
            const content = getContentElementRef.current?.() ?? viewport.firstElementChild
            if (content) resizeObserver.observe(content)
        }

        viewport.addEventListener('wheel', onWheel, { capture: true, passive: true })
        viewport.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
        viewport.addEventListener('touchmove', onTouchMove, { capture: true, passive: true })
        viewport.addEventListener('touchend', onTouchEnd, { capture: true, passive: true })
        viewport.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true })
        viewport.addEventListener('scroll', onScroll, { passive: true })
        viewport.addEventListener('selectstart', onSelectStart)
        window.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
        window.addEventListener('pointerup', onPointerEnd, true)
        window.addEventListener('pointercancel', onPointerEnd, true)
        document.addEventListener('selectionchange', syncSelectionLock)
        syncSelectionLock()

        return () => {
            resizeObserver?.disconnect()
            if (selectionProbeTimer != null) window.clearTimeout(selectionProbeTimer)
            viewport.removeEventListener('wheel', onWheel, true)
            viewport.removeEventListener('touchstart', onTouchStart, true)
            viewport.removeEventListener('touchmove', onTouchMove, true)
            viewport.removeEventListener('touchend', onTouchEnd, true)
            viewport.removeEventListener('touchcancel', onTouchEnd, true)
            viewport.removeEventListener('scroll', onScroll)
            viewport.removeEventListener('selectstart', onSelectStart)
            window.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('pointerdown', onPointerDown, true)
            window.removeEventListener('pointerup', onPointerEnd, true)
            window.removeEventListener('pointercancel', onPointerEnd, true)
            document.removeEventListener('selectionchange', syncSelectionLock)
        }
    }, [
        getViewport,
        commitFollowing,
        markUserScrollIntent,
        getActiveUserScrollIntent,
        maybeFollow,
        epsilonPx
    ])

    useEffect(() => {
        return () => {
            if (programmaticFrameRef.current !== null) {
                cancelAnimationFrame(programmaticFrameRef.current)
            }
        }
    }, [])

    const setFollow = useCallback((v: boolean) => commitFollowing(v), [commitFollowing])

    return useMemo(
        () => ({
            follow,
            attach,
            scrollToBottom,
            maybeFollow,
            setFollow,
            isFollowing: () => followingRef.current && !selectionLockRef.current
        }),
        [follow, attach, scrollToBottom, maybeFollow, setFollow]
    )
}

export default useAutoScroll
