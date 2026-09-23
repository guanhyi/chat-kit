// @vitest-environment jsdom
import React, { act, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAutoScroll } from './useAutoScroll'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

type Ctrl = ReturnType<typeof useAutoScroll>

const VIEWPORT_HEIGHT = 400

/** jsdom 没有布局：给 viewport 装上可控的 scrollHeight/clientHeight/scrollTop */
function mockGeometry(viewport: HTMLElement, initialContentHeight: number) {
    let contentHeight = initialContentHeight
    let top = 0
    const clamp = (value: number) =>
        Math.max(0, Math.min(value, Math.max(0, contentHeight - VIEWPORT_HEIGHT)))
    Object.defineProperty(viewport, 'clientHeight', { get: () => VIEWPORT_HEIGHT })
    Object.defineProperty(viewport, 'scrollHeight', { get: () => contentHeight })
    Object.defineProperty(viewport, 'scrollTop', {
        get: () => top,
        set: (value: number) => {
            top = clamp(value)
        }
    })
    // jsdom 没有 smooth 动画：按落到目标处理，目标本身就是调用时的 scrollHeight
    const scrollToTargets: number[] = []
    viewport.scrollTo = ((options: ScrollToOptions | number) => {
        const value = typeof options === 'number' ? options : (options.top ?? top)
        scrollToTargets.push(value)
        top = clamp(value)
        viewport.dispatchEvent(new Event('scroll'))
    }) as HTMLElement['scrollTo']
    return {
        setContentHeight(value: number) {
            contentHeight = value
        },
        /** 组件调用 viewport.scrollTo 时传入的目标位置 */
        scrollToTargets,
        /** 模拟一次滚动（用户或布局），并派发 scroll 事件 */
        scrollTo(value: number) {
            top = clamp(value)
            viewport.dispatchEvent(new Event('scroll'))
        }
    }
}

/** 等若干个真实的 rAF 帧，驱动贴底锁的收敛循环 */
async function runFrames(frames = 6) {
    for (let index = 0; index < frames; index++) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        })
    }
}

function Harness({ onReady }: { onReady: (ctrl: Ctrl, viewport: HTMLElement) => void }) {
    const viewportRef = useRef<HTMLDivElement>(null)
    const ctrl = useAutoScroll(() => viewportRef.current)
    useEffect(() => ctrl.attach(), [ctrl.attach])
    useEffect(() => {
        if (viewportRef.current) onReady(ctrl, viewportRef.current)
    })
    return (
        <div ref={viewportRef}>
            <div />
        </div>
    )
}

let container: HTMLDivElement
let root: Root
let ctrl: Ctrl
let viewport: HTMLElement
let geometry: ReturnType<typeof mockGeometry>

beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root.render(
            <Harness
                onReady={(nextCtrl, nextViewport) => {
                    ctrl = nextCtrl
                    viewport = nextViewport
                }}
            />
        )
    })
    geometry = mockGeometry(viewport, 1000)
    // 起始贴底
    act(() => ctrl.scrollToBottom())
    expect(viewport.scrollTop).toBe(600)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

/** 模拟一次内容长高后调用方的贴底入口 */
function grow(contentHeight: number) {
    geometry.setContentHeight(contentHeight)
    act(() => ctrl.maybeFollow())
}

describe('useAutoScroll', () => {
    it('keeps following while content grows', () => {
        grow(1200)
        expect(viewport.scrollTop).toBe(800)
        grow(1500)
        expect(viewport.scrollTop).toBe(1100)
    })

    it('does not treat clicks in the content or composer as scroll intent', () => {
        const button = document.createElement('button')
        document.body.appendChild(button)
        button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
        viewport.firstElementChild!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
        // 点击后紧跟一次布局补偿引起的离底 scroll，也不能关掉跟随
        grow(1200)
        act(() => geometry.scrollTo(500))
        grow(1300)
        expect(ctrl.isFollowing()).toBe(true)
        expect(viewport.scrollTop).toBe(900)
        button.remove()
    })

    it('drops following on wheel up before the scroll event fires, and never pulls back', () => {
        act(() => {
            viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
        })
        expect(ctrl.isFollowing()).toBe(false)
        // 同帧内容长高：不得把用户拽回底部
        grow(1200)
        expect(viewport.scrollTop).toBe(600)
        act(() => geometry.scrollTo(300))
        grow(1500)
        expect(viewport.scrollTop).toBe(300)
        expect(ctrl.follow).toBe(false)
    })

    it('resumes following when the user scrolls back to the bottom', () => {
        act(() => {
            viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
            geometry.scrollTo(300)
        })
        expect(ctrl.isFollowing()).toBe(false)
        act(() => {
            viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }))
            geometry.scrollTo(600)
        })
        expect(ctrl.isFollowing()).toBe(true)
        grow(1200)
        expect(viewport.scrollTop).toBe(800)
    })

    it('keeps following when layout compensation scrolls without user input', () => {
        grow(1200)
        // 虚拟列表测高补偿改了 scrollTop，但没有任何用户输入
        act(() => geometry.scrollTo(500))
        expect(ctrl.isFollowing()).toBe(true)
        grow(1300)
        expect(viewport.scrollTop).toBe(900)
    })

    it('scrollToBottom restores following after the user scrolled away', () => {
        act(() => {
            viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
            geometry.scrollTo(200)
        })
        expect(ctrl.isFollowing()).toBe(false)
        act(() => ctrl.scrollToBottom())
        expect(ctrl.isFollowing()).toBe(true)
        expect(viewport.scrollTop).toBe(600)
        grow(1200)
        expect(viewport.scrollTop).toBe(800)
    })

    it('lands at the real bottom after the virtual list measures the rows below', async () => {
        // 用户上滚到对话中间，在某一条上点「再试一次」
        act(() => {
            viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
            geometry.scrollTo(100)
        })
        expect(ctrl.isFollowing()).toBe(false)

        // 此刻下方消息还没测高，scrollHeight 只是估算值
        act(() => ctrl.scrollToBottom('smooth'))
        expect(viewport.scrollTop).toBe(600)

        // 虚拟列表随后测到真实高度。这不经过 React 提交，没有人调 maybeFollow
        geometry.setContentHeight(3000)
        await runFrames()
        expect(viewport.scrollTop).toBe(2600)
        expect(ctrl.isFollowing()).toBe(true)
    })

    it('skips the animation when the bottom is far away', () => {
        act(() => {
            viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
            geometry.scrollTo(0)
        })
        geometry.setContentHeight(5000)
        act(() => ctrl.scrollToBottom('smooth'))
        // 离底 4600px：直接瞬时贴底，不启动一个必定瞄不准的动画
        expect(geometry.scrollToTargets).toEqual([])
        expect(viewport.scrollTop).toBe(4600)
    })

    it('does not let layout compensation during the jump revoke following', async () => {
        act(() => {
            viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
            geometry.scrollTo(100)
        })
        act(() => ctrl.scrollToBottom())

        // 等回复的空档里内容高度不变，虚拟列表却做了一次测高补偿。
        // 以前这种 scroll 会被兜底判成「用户滚动」，跟随就此断掉。
        await runFrames(2)
        act(() => geometry.scrollTo(200))
        expect(ctrl.isFollowing()).toBe(true)
        await runFrames(2)
        expect(viewport.scrollTop).toBe(600)
    })

    it('stops correcting the moment the user scrolls up', async () => {
        act(() => ctrl.scrollToBottom())
        act(() => {
            viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
            geometry.scrollTo(200)
        })
        geometry.setContentHeight(3000)
        await runFrames()
        expect(ctrl.isFollowing()).toBe(false)
        expect(viewport.scrollTop).toBe(200)
    })

    it('is not blocked by the selectstart a plain click in the list fires', async () => {
        act(() => {
            viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
            geometry.scrollTo(100)
        })
        // 点消息下面的「再试一次」：浏览器会先派发 selectstart，但选区是空的
        act(() => {
            viewport.firstElementChild!.dispatchEvent(
                new Event('selectstart', { bubbles: true })
            )
        })
        act(() => ctrl.scrollToBottom('smooth'))
        expect(viewport.scrollTop).toBe(600)
        expect(ctrl.isFollowing()).toBe(true)
        grow(1200)
        expect(viewport.scrollTop).toBe(800)
    })

    it('treats dragging the scrollbar as user input judged by landing position', () => {
        viewport.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
        act(() => geometry.scrollTo(200))
        expect(ctrl.isFollowing()).toBe(false)
        grow(1200)
        expect(viewport.scrollTop).toBe(200)
    })
})
