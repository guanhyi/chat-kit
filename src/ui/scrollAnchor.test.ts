import { describe, expect, it } from 'vitest'
import {
    anchorActionAfterContentChange,
    bottomSettleAction,
    classifyScrollSource,
    distanceToBottom,
    isAtBottom,
    keyboardScrollIntent,
    reconcileFollowingForContentAnchor,
    resolveFollowingAfterScroll,
    shouldAnimateScrollToBottom,
    touchScrollIntent,
    wheelScrollIntent
} from './scrollAnchor'

const atBottom = { scrollTop: 600, viewportHeight: 400, contentHeight: 1000 }
const midway = { scrollTop: 200, viewportHeight: 400, contentHeight: 1000 }

describe('distanceToBottom / isAtBottom', () => {
    it('clamps to zero when content is shorter than the viewport', () => {
        expect(distanceToBottom({ scrollTop: 0, viewportHeight: 400, contentHeight: 100 })).toBe(0)
    })

    it('treats small gaps as bottom', () => {
        expect(isAtBottom({ ...atBottom, scrollTop: 560 })).toBe(true)
        expect(isAtBottom({ ...atBottom, scrollTop: 540 })).toBe(false)
    })
})

describe('user scroll intent', () => {
    it('maps wheel direction', () => {
        expect(wheelScrollIntent(-10)).toBe('awayFromBottom')
        expect(wheelScrollIntent(10)).toBe('towardBottom')
        expect(wheelScrollIntent(0)).toBe('none')
    })

    it('maps finger movement opposite to scroll direction', () => {
        expect(touchScrollIntent(100, 140)).toBe('awayFromBottom')
        expect(touchScrollIntent(140, 100)).toBe('towardBottom')
        expect(touchScrollIntent(100, 100)).toBe('none')
    })

    it('ignores keys typed into editable targets', () => {
        expect(keyboardScrollIntent({ key: 'ArrowUp', shiftKey: false, editableTarget: true })).toBe(
            'none'
        )
        expect(keyboardScrollIntent({ key: 'PageUp', shiftKey: false, editableTarget: false })).toBe(
            'awayFromBottom'
        )
        expect(keyboardScrollIntent({ key: ' ', shiftKey: true, editableTarget: false })).toBe(
            'awayFromBottom'
        )
        expect(keyboardScrollIntent({ key: ' ', shiftKey: false, editableTarget: false })).toBe(
            'towardBottom'
        )
        expect(keyboardScrollIntent({ key: 'a', shiftKey: false, editableTarget: false })).toBe(
            'none'
        )
    })
})

describe('classifyScrollSource', () => {
    it('lets user intent win over everything else', () => {
        expect(
            classifyScrollSource({
                userScrollIntent: 'awayFromBottom',
                programmatic: true,
                withinLayoutGuard: true
            })
        ).toBe('user')
    })

    it('recognizes echoes of programmatic scrolls and layout compensation', () => {
        expect(
            classifyScrollSource({ userScrollIntent: 'none', programmatic: true, withinLayoutGuard: true })
        ).toBe('programmatic')
        expect(
            classifyScrollSource({ userScrollIntent: 'none', programmatic: false, withinLayoutGuard: true })
        ).toBe('layout')
    })

    it('treats unclassified scrolls outside the guard as user scrolls', () => {
        expect(
            classifyScrollSource({
                userScrollIntent: 'none',
                programmatic: false,
                withinLayoutGuard: false
            })
        ).toBe('user')
    })
})

describe('resolveFollowingAfterScroll', () => {
    it('never changes following for layout or programmatic scrolls', () => {
        expect(resolveFollowingAfterScroll({ following: true, metrics: midway, source: 'layout' })).toBe(
            true
        )
        expect(
            resolveFollowingAfterScroll({ following: false, metrics: atBottom, source: 'programmatic' })
        ).toBe(false)
    })

    it('follows iff a user scroll lands at the bottom', () => {
        expect(resolveFollowingAfterScroll({ following: true, metrics: midway, source: 'user' })).toBe(
            false
        )
        expect(resolveFollowingAfterScroll({ following: false, metrics: atBottom, source: 'user' })).toBe(
            true
        )
    })
})

describe('reconcileFollowingForContentAnchor', () => {
    it('drops following on an explicit upward scroll even if the scroll event has not fired', () => {
        expect(
            reconcileFollowingForContentAnchor({
                following: true,
                metrics: atBottom,
                lastObservedScrollTop: 600,
                userScrollIntent: 'awayFromBottom'
            })
        ).toBe(false)
    })

    it('keeps following when there is no user input, even if layout pulled scrollTop back', () => {
        expect(
            reconcileFollowingForContentAnchor({
                following: true,
                metrics: midway,
                lastObservedScrollTop: 600,
                userScrollIntent: 'none'
            })
        ).toBe(true)
    })

    it('resolves unknown input by landing position', () => {
        const base = { following: false, lastObservedScrollTop: 600, userScrollIntent: 'unknown' as const }
        expect(reconcileFollowingForContentAnchor({ ...base, metrics: atBottom })).toBe(true)
        expect(
            reconcileFollowingForContentAnchor({ ...base, following: true, metrics: midway })
        ).toBe(false)
        expect(
            reconcileFollowingForContentAnchor({
                ...base,
                following: true,
                metrics: midway,
                lastObservedScrollTop: 200
            })
        ).toBe(true)
    })
})

describe('anchorActionAfterContentChange', () => {
    it('sticks only while following', () => {
        expect(anchorActionAfterContentChange(true)).toBe('stickToBottom')
        expect(anchorActionAfterContentChange(false)).toBe('hold')
    })
})

describe('shouldAnimateScrollToBottom', () => {
    it('animates only when the bottom is within reach', () => {
        expect(shouldAnimateScrollToBottom(atBottom)).toBe(true)
        // 离底 400px，正好一屏
        expect(shouldAnimateScrollToBottom(midway)).toBe(true)
        // 离底 4600px：途经的消息都还没测高，动画一定瞄不准
        expect(
            shouldAnimateScrollToBottom({
                scrollTop: 0,
                viewportHeight: 400,
                contentHeight: 5000
            })
        ).toBe(false)
    })
})

describe('bottomSettleAction', () => {
    const settling = {
        following: true,
        metrics: atBottom,
        lastContentHeight: 1000,
        stableFrames: 0,
        smoothActive: false,
        elapsedMs: 0
    }

    it('hands the scroll back as soon as the user takes it', () => {
        expect(bottomSettleAction({ ...settling, following: false })).toBe('stop')
    })

    it('gives up after the timeout instead of holding rAF forever', () => {
        expect(bottomSettleAction({ ...settling, elapsedMs: 2001, metrics: midway })).toBe('stop')
    })

    it('re-aligns whenever the virtual list re-measures', () => {
        // 内容长高了（虚拟行测到真实高度），上一次落点已经不是底部
        expect(bottomSettleAction({ ...settling, lastContentHeight: 800 })).toBe('stick')
    })

    it('retargets instead of snapping while the smooth animation runs', () => {
        expect(
            bottomSettleAction({ ...settling, lastContentHeight: 800, smoothActive: true })
        ).toBe('retarget')
    })

    it('keeps correcting a landing that fell short of the bottom', () => {
        // 高度已经稳定，但没到底：一次性 scrollTo 瞄的是偏小的 scrollHeight
        expect(bottomSettleAction({ ...settling, metrics: midway, stableFrames: 5 })).toBe('stick')
    })

    it('lets the smooth animation finish on its own while the height holds still', () => {
        expect(
            bottomSettleAction({
                ...settling,
                metrics: midway,
                stableFrames: 5,
                smoothActive: true
            })
        ).toBe('hold')
    })

    it('settles only after the height stops changing at the bottom', () => {
        expect(bottomSettleAction({ ...settling, stableFrames: 1 })).toBe('stick')
        expect(bottomSettleAction({ ...settling, stableFrames: 2 })).toBe('stop')
    })
})
