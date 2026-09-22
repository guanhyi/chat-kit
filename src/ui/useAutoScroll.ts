import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Options = {
    /**
     * 预留的阈值配置：
     * - 目前实现只依赖滚动距离判断是否在底部，不再强依赖 IntersectionObserver；
     * - threshold 目前仅作为预留参数，方便后续扩展（例如按比例容忍离底部的距离）。
     */
    threshold?: number
}

const USER_INTERACTION_GUARD_MS = 800
const BOTTOM_EPSILON_PX = 2

const distanceToBottom = (viewport: HTMLElement) =>
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight

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
 * 自动滚动 Hook：
 * - 仅依赖滚动事件 + MutationObserver，在「跟随模式」下保持视图贴底；
 * - 用户交互（wheel/touch/pointer/keyboard）会关闭跟随，直到再次滚动回列表底部；
 * - 列表内存在非空文字选区时暂停跟随，避免手机拖选时系统自动滚和贴底抢滚动；
 * - 不再强依赖底部哨兵元素，避免虚拟滚动场景下哨兵被频繁卸载导致逻辑失效。
 *
 * 说明：
 * - 第二个参数 sentinelRef 现在是可选且不会参与逻辑，仅保留类型兼容；
 * - 这样 ChatBubbleList 等调用方可以移除实际 DOM 哨兵，而不影响外部 API。
 */
export function useAutoScroll(
    getViewport: () => HTMLElement | null,
    // 为兼容旧调用签名保留该参数，但当前实现不会使用
    _sentinelRef?: RefObject<HTMLElement>,
    options: Options = {}
) {
    // 目前实现暂不使用 threshold，只保留为未来扩展
    const _threshold = options.threshold

    const followRef = useRef(true)
    const [follow, setFollow] = useState(true)
    const programmaticRef = useRef(false)
    const moRef = useRef<MutationObserver | null>(null)
    const followTaskPendingRef = useRef(false)
    const pendingFollowModeRef = useRef<'force' | 'soft'>('force')
    // 标记用户是否正在进行交互（鼠标滚轮/触摸/键盘/指针等）
    const userInteractingRef = useRef(false)
    const userInteractTimeoutRef = useRef<number | null>(null)
    // 列表内正在拖选文字时锁定，阻止贴底把选区自动滚动拉回去
    const selectionLockRef = useRef(false)

    const updateFollow = useCallback((v: boolean) => {
        followRef.current = v
        setFollow(v)
    }, [])

    const scrollToBottom = useCallback(
        (behavior: ScrollBehavior | 'instant' = 'instant') => {
            if (selectionLockRef.current) return
            const viewport = getViewport()
            if (!viewport) return
            programmaticRef.current = true
            if (behavior === 'instant' || behavior === 'auto') {
                // 对齐 ZCode：贴底必须同步写 scrollTop。smooth 的中间帧会被当成离底，
                // 流式长高时也会晚一帧才到底。
                viewport.scrollTop = viewport.scrollHeight
            } else {
                viewport.scrollTo({ top: viewport.scrollHeight, behavior })
            }
            requestAnimationFrame(() => {
                programmaticRef.current = false
            })
        },
        [getViewport]
    )

    const maybeFollow = useCallback(() => {
        if (selectionLockRef.current) return
        if (!followRef.current) return
        if (userInteractingRef.current) return
        scrollToBottom('instant')
    }, [scrollToBottom])

    // 标记一次用户交互，短时间内视为“用户发起”的滚动
    const markUserInteracting = useCallback(() => {
        userInteractingRef.current = true
        if (userInteractTimeoutRef.current) window.clearTimeout(userInteractTimeoutRef.current)
        userInteractTimeoutRef.current = window.setTimeout(() => {
            userInteractingRef.current = false
        }, USER_INTERACTION_GUARD_MS)
    }, [])

    const attach = useCallback(() => {
        const bindViewport = (viewport: HTMLElement) => {
            const lockSelection = () => {
                if (selectionLockRef.current) return
                selectionLockRef.current = true
                // 只改 ref：选区刚出现时 setState 会重渲染 VList，原生选区会被拆掉
                followRef.current = false
            }

            const unlockSelection = () => {
                if (!selectionLockRef.current) return
                selectionLockRef.current = false
                if (distanceToBottom(viewport) <= BOTTOM_EPSILON_PX) {
                    updateFollow(true)
                }
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

            const onSelectionChange = () => {
                syncSelectionLock()
            }

            // iOS 长按松手后选区才出现，补一次探测，避免手柄拖动开始时贴底还没锁上
            let selectionProbeTimer: number | null = null
            const onTouchEnd = () => {
                if (selectionProbeTimer != null) window.clearTimeout(selectionProbeTimer)
                selectionProbeTimer = window.setTimeout(() => {
                    selectionProbeTimer = null
                    if (isNonCollapsedSelectionInside(viewport)) {
                        lockSelection()
                    }
                }, 300)
            }

            // 监听用户交互：非底部滚轮则关闭跟随
            const onWheel = (event: WheelEvent) => {
                markUserInteracting()
                if (selectionLockRef.current) return
                const distance = distanceToBottom(viewport)
                if (distance <= BOTTOM_EPSILON_PX) {
                    // 当仍处于底部且用户尝试向上滚动时立即关闭跟随，避免 MO 抢回控制权
                    if (event.deltaY < 0) {
                        updateFollow(false)
                    }
                    return
                }
                if (distance > BOTTOM_EPSILON_PX) updateFollow(false)
            }
            viewport.addEventListener('wheel', onWheel, { passive: true })

            // 触摸/指针/键盘：均视为用户交互
            const onTouchStart = () => markUserInteracting()
            const onPointerDown = () => markUserInteracting()
            const onKeyDown = (ev: KeyboardEvent) => {
                // 常见滚动相关按键
                const keys = [
                    'ArrowUp',
                    'ArrowDown',
                    'PageUp',
                    'PageDown',
                    'Home',
                    'End',
                    'Space'
                ]
                if (keys.includes(ev.key)) markUserInteracting()
            }
            viewport.addEventListener('touchstart', onTouchStart, { passive: true })
            viewport.addEventListener('touchend', onTouchEnd, { passive: true })
            viewport.addEventListener('pointerdown', onPointerDown, { passive: true })
            window.addEventListener('pointerdown', onPointerDown, { passive: true })
            window.addEventListener('keydown', onKeyDown)

            // 滚动事件：当用户主动滚到底部时，立即恢复跟随
            const onScroll = () => {
                if (selectionLockRef.current) return
                if (programmaticRef.current) return
                const distance = distanceToBottom(viewport)
                if (distance <= BOTTOM_EPSILON_PX) {
                    updateFollow(true)
                } else if (userInteractingRef.current) {
                    // 仅在用户交互触发的离底部滚动时，关闭跟随，避免 MO/虚拟列表引起的误判
                    updateFollow(false)
                }
            }
            viewport.addEventListener('scroll', onScroll, { passive: true })
            viewport.addEventListener('selectstart', onSelectStart)
            document.addEventListener('selectionchange', onSelectionChange)
            syncSelectionLock()

            // MutationObserver：内容变化时仅在跟随下贴底，并通过 microtask 合并
            moRef.current?.disconnect()
            moRef.current = new MutationObserver((records) => {
                if (selectionLockRef.current) return
                if (!followRef.current) return

                // 关键：只修复“结束后抖动”，不影响流式贴底的平滑度
                //
                // - 流式正文更新：通常会产生 childList/characterData 变更，需要强制贴底（force）
                // - 虚拟列表测量/定位：会产生子元素 style 变更，允许贴底，但在离底部 <= 2px 时不再反复 scrollTo（soft）
                // - OverlayScrollbars：会持续改动 viewport 自身 style（例如自动隐藏/变量刷新），这类变更不应触发贴底，否则会形成回环抖动
                const hasContentMutation = records.some(
                    (record) => record.type === 'childList' || record.type === 'characterData'
                )
                const hasNonViewportStyleMutation = records.some(
                    (record) =>
                        record.type === 'attributes' &&
                        record.attributeName === 'style' &&
                        record.target !== viewport
                )

                if (!hasContentMutation && !hasNonViewportStyleMutation) {
                    return
                }

                const mode: 'force' | 'soft' = hasContentMutation ? 'force' : 'soft'

                if (followTaskPendingRef.current) {
                    // 若同一轮里先收到 style 变更、后收到内容变更，升级为 force，避免流式变卡
                    if (mode === 'force') pendingFollowModeRef.current = 'force'
                    return
                }

                followTaskPendingRef.current = true
                pendingFollowModeRef.current = mode

                const flush = () => {
                    followTaskPendingRef.current = false
                    const pendingMode = pendingFollowModeRef.current
                    pendingFollowModeRef.current = 'force'

                    if (pendingMode === 'soft') {
                        const distance = distanceToBottom(viewport)
                        // deadband：离底部非常近时不再重复 scrollTo，避免“最后一行来回抖”
                        if (distance <= BOTTOM_EPSILON_PX) return
                    }

                    maybeFollow()
                }

                if (typeof queueMicrotask === 'function') {
                    queueMicrotask(flush)
                } else if (typeof Promise !== 'undefined') {
                    Promise.resolve().then(flush)
                } else {
                    setTimeout(flush, 0)
                }
            })
            moRef.current.observe(viewport, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['style']
            })

            return () => {
                moRef.current?.disconnect()
                moRef.current = null
                viewport.removeEventListener('wheel', onWheel)
                viewport.removeEventListener('touchstart', onTouchStart)
                viewport.removeEventListener('touchend', onTouchEnd)
                viewport.removeEventListener('pointerdown', onPointerDown)
                if (selectionProbeTimer != null) window.clearTimeout(selectionProbeTimer)
                window.removeEventListener('keydown', onKeyDown)
                window.removeEventListener('pointerdown', onPointerDown)
                viewport.removeEventListener('scroll', onScroll)
                viewport.removeEventListener('selectstart', onSelectStart)
                document.removeEventListener('selectionchange', onSelectionChange)
            }
        }

        let destroyed = false
        let cleanup: (() => void) | null = null
        let currentViewport: HTMLElement | null = null
        let rafId: number | null = null
        let sameViewportFrames = 0

        const syncViewport = () => {
            if (destroyed) return
            const nextViewport = getViewport()
            if (nextViewport !== currentViewport) {
                sameViewportFrames = 0
                cleanup?.()
                currentViewport = nextViewport ?? null
                if (nextViewport) {
                    cleanup = bindViewport(nextViewport)
                } else {
                    cleanup = null
                }
            } else if (currentViewport) {
                sameViewportFrames += 1
            }

            if (!currentViewport || sameViewportFrames < 60) {
                rafId = window.requestAnimationFrame(syncViewport)
            } else if (rafId !== null) {
                window.cancelAnimationFrame(rafId)
                rafId = null
            }
        }

        syncViewport()

        const intervalId = window.setInterval(() => {
            if (destroyed) return
            if (!currentViewport || !currentViewport.isConnected) {
                sameViewportFrames = 0
                syncViewport()
                return
            }
            const nextViewport = getViewport()
            if (nextViewport !== currentViewport) {
                sameViewportFrames = 0
                syncViewport()
            }
        }, 500)

        return () => {
            destroyed = true
            if (rafId !== null) {
                window.cancelAnimationFrame(rafId)
                rafId = null
            }
            window.clearInterval(intervalId)
            cleanup?.()
            cleanup = null
            currentViewport = null
            if (userInteractTimeoutRef.current) window.clearTimeout(userInteractTimeoutRef.current)
            userInteractTimeoutRef.current = null
        }
    }, [getViewport, updateFollow, maybeFollow, markUserInteracting])

    useEffect(() => {
        // 兜底清理 MO，防止调用方忘记执行 detach
        return () => {
            moRef.current?.disconnect()
        }
    }, [])

    return useMemo(
        () => ({
            follow,
            attach,
            scrollToBottom,
            maybeFollow,
            setFollow: updateFollow,
            isFollowing: () => followRef.current && !selectionLockRef.current
        }),
        [follow, attach, scrollToBottom, maybeFollow, updateFollow]
    )
}

export default useAutoScroll
