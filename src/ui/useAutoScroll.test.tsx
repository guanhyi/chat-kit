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
    return {
        setContentHeight(value: number) {
            contentHeight = value
        },
        /** 模拟一次滚动（用户或布局），并派发 scroll 事件 */
        scrollTo(value: number) {
            top = clamp(value)
            viewport.dispatchEvent(new Event('scroll'))
        }
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

    it('treats dragging the scrollbar as user input judged by landing position', () => {
        viewport.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
        act(() => geometry.scrollTo(200))
        expect(ctrl.isFollowing()).toBe(false)
        grow(1200)
        expect(viewport.scrollTop).toBe(200)
    })
})
