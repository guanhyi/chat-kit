import { RefObject, useCallback, useEffect, useRef, useState } from 'react'

type Options = {
    /**
     * 预留的阈值配置：
     * - 目前实现只依赖滚动距离判断是否在底部，不再强依赖 IntersectionObserver；
     * - threshold 目前仅作为预留参数，方便后续扩展（例如按比例容忍离底部的距离）。
     */
    threshold?: number
}

/**
 * 自动滚动 Hook：
 * - 仅依赖滚动事件 + MutationObserver，在「跟随模式」下保持视图贴底；
 * - 用户交互（wheel/touch/pointer/keyboard）会关闭跟随，直到再次滚动回列表底部；
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
    // 标记用户是否正在进行交互（鼠标滚轮/触摸/键盘/指针等）
    const userInteractingRef = useRef(false)
    const userInteractTimeoutRef = useRef<number | null>(null)
    // 允许的“离底部”误差：避免由于小数像素/虚拟列表测量/滚动条布局抖动造成反复 scrollTo
    const bottomEpsilonPxRef = useRef(2)
    const followRafIdRef = useRef<number | null>(null)

    const distanceToBottom = useCallback((viewport: HTMLElement) => {
        return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    }, [])

    const isNearBottom = useCallback(
        (viewport: HTMLElement) => {
            return distanceToBottom(viewport) <= bottomEpsilonPxRef.current
        },
        [distanceToBottom]
    )

    const updateFollow = useCallback((v: boolean) => {
        followRef.current = v
        setFollow(v)
    }, [])

    const scrollToBottom = useCallback(
        (behavior: ScrollBehavior | 'instant' = 'instant') => {
            const viewport = getViewport()
            if (!viewport) return
            // 已在底部则不做无意义的 scrollTo，避免与虚拟列表/自定义滚动条产生“抢控制权”抖动
            if (isNearBottom(viewport)) return
            programmaticRef.current = true
            const bh: ScrollBehavior =
                behavior === 'instant' ? ('auto' as ScrollBehavior) : behavior
            const maxScrollTop = viewport.scrollHeight - viewport.clientHeight
            viewport.scrollTo({ top: maxScrollTop, behavior: bh })
            // 短暂释放 programmatic 标记，允许用户接管
            requestAnimationFrame(() => {
                programmaticRef.current = false
            })
        },
        [getViewport, isNearBottom]
    )

    const maybeFollow = useCallback(() => {
        if (!followRef.current) return
        scrollToBottom('auto')
    }, [scrollToBottom])

    // 标记一次用户交互，短时间内视为“用户发起”的滚动
    const markUserInteracting = useCallback(() => {
        userInteractingRef.current = true
        if (userInteractTimeoutRef.current) window.clearTimeout(userInteractTimeoutRef.current)
        userInteractTimeoutRef.current = window.setTimeout(() => {
            userInteractingRef.current = false
        }, 250)
    }, [])

    const attach = useCallback(() => {
        const bindViewport = (viewport: HTMLElement) => {
            const scheduleFollow = () => {
                if (followRafIdRef.current !== null) return
                followRafIdRef.current = window.requestAnimationFrame(() => {
                    followRafIdRef.current = null
                    maybeFollow()
                })
            }

            // 监听用户交互：非底部滚轮则关闭跟随
            const onWheel = (event: WheelEvent) => {
                markUserInteracting()
                const distance = distanceToBottom(viewport)
                if (distance <= bottomEpsilonPxRef.current) {
                    // 当仍处于底部且用户尝试向上滚动时立即关闭跟随，避免 MO 抢回控制权
                    if (event.deltaY < 0) {
                        updateFollow(false)
                    }
                    return
                }
                if (distance > bottomEpsilonPxRef.current) updateFollow(false)
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
            viewport.addEventListener('pointerdown', onPointerDown, { passive: true })
            window.addEventListener('pointerdown', onPointerDown, { passive: true })
            window.addEventListener('keydown', onKeyDown)

            // 滚动事件：当用户主动滚到底部时，立即恢复跟随
            const onScroll = () => {
                if (programmaticRef.current) return
                const distance = distanceToBottom(viewport)
                if (distance <= bottomEpsilonPxRef.current) {
                    updateFollow(true)
                } else if (userInteractingRef.current) {
                    // 仅在用户交互触发的离底部滚动时，关闭跟随，避免 MO/虚拟列表引起的误判
                    updateFollow(false)
                }
            }
            viewport.addEventListener('scroll', onScroll, { passive: true })

            // MutationObserver：内容变化时仅在跟随下贴底
            moRef.current?.disconnect()
            moRef.current = new MutationObserver((records) => {
                if (!followRef.current) return
                // 1) 流式渲染会频繁产生 text/childList 变化：需要及时贴底
                // 2) virtua 会通过 style 更新进行测量/定位：也需要跟随
                // 3) OverlayScrollbars 会改动 viewport 自身样式/属性：忽略它，避免“结束后来回抖动”
                for (const record of records) {
                    if (record.type === 'childList' || record.type === 'characterData') {
                        scheduleFollow()
                        return
                    }
                    if (record.type === 'attributes') {
                        if (record.target === viewport) continue
                        scheduleFollow()
                        return
                    }
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
                if (followRafIdRef.current !== null) {
                    window.cancelAnimationFrame(followRafIdRef.current)
                    followRafIdRef.current = null
                }
                viewport.removeEventListener('wheel', onWheel)
                viewport.removeEventListener('touchstart', onTouchStart)
                viewport.removeEventListener('pointerdown', onPointerDown)
                window.removeEventListener('keydown', onKeyDown)
                window.removeEventListener('pointerdown', onPointerDown)
                viewport.removeEventListener('scroll', onScroll)
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

    return { follow, attach, scrollToBottom, maybeFollow, setFollow: updateFollow }
}

export default useAutoScroll
