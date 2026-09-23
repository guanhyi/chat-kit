// 聊天列表底部锚定状态机（纯函数，无 DOM/React 依赖）。
//
// 逻辑移植自 ZCode packages/ui/src/v4/timelineScrollAnchor.ts（Apache-2.0），
// 去掉了宽度过渡、前插锚定等本项目用不到的分支。
//
// 语义：
// - 用户位于底部 → following=true，新内容（新消息 / 流式 delta / 测高变化）自动贴底；
// - 用户上滚离底 → following=false，流式增量不得拉回阅读位置；
// - 用户手动滚回底部（或调用 scrollToBottom）→ 恢复跟随。
//
// following 表达用户的滚动权，不是瞬时几何快照：只有真实用户滚动输入可以改变它；
// 程序化贴底和虚拟列表测高补偿产生的 scroll 事件只更新位置账目。

/** 离底判定容差：小于该距离视为「在底部」。覆盖亚像素滚动与最后一行的留白。 */
export const BOTTOM_ANCHOR_EPSILON_PX = 48

/** 小于该值的 scrollTop 回退视为亚像素抖动，不算用户上滚。 */
export const UNOBSERVED_SCROLL_EPSILON_PX = 2

/** 用户滚动意图的有效期：超过后不再参与 scroll 来源裁决。 */
export const USER_SCROLL_INTENT_TTL_MS = 1200

/** 内容变化后的布局保护窗：窗内无用户意图的 scroll 视为布局补偿。 */
export const LAYOUT_SCROLL_GUARD_MS = 250

export interface ScrollMetrics {
    scrollTop: number
    /** 滚动容器可视高度（clientHeight）。 */
    viewportHeight: number
    /** 内容总高度（scrollHeight）。 */
    contentHeight: number
}

/** 距底部的剩余可滚动距离（内容不足一屏时为 0）。 */
export function distanceToBottom(metrics: ScrollMetrics): number {
    return Math.max(0, metrics.contentHeight - metrics.viewportHeight - metrics.scrollTop)
}

export function isAtBottom(
    metrics: ScrollMetrics,
    epsilonPx: number = BOTTOM_ANCHOR_EPSILON_PX
): boolean {
    return distanceToBottom(metrics) <= epsilonPx
}

export type UserScrollIntent = 'none' | 'awayFromBottom' | 'towardBottom' | 'unknown'

/** wheel 的 deltaY 与 scrollTop 同向：负值阅读更早内容，正值靠近底部。 */
export function wheelScrollIntent(deltaY: number): UserScrollIntent {
    if (deltaY < 0) return 'awayFromBottom'
    if (deltaY > 0) return 'towardBottom'
    return 'none'
}

/** touch 手指位移与 scrollTop 反向：手指下移表示阅读更早内容。 */
export function touchScrollIntent(previousClientY: number, nextClientY: number): UserScrollIntent {
    if (nextClientY > previousClientY) return 'awayFromBottom'
    if (nextClientY < previousClientY) return 'towardBottom'
    return 'none'
}

/** 键盘滚动意图；输入控件内的光标按键不属于列表滚动。 */
export function keyboardScrollIntent(input: {
    key: string
    shiftKey: boolean
    editableTarget: boolean
}): UserScrollIntent {
    if (input.editableTarget) return 'none'
    if (input.key === 'ArrowUp' || input.key === 'PageUp' || input.key === 'Home') {
        return 'awayFromBottom'
    }
    if (input.key === 'ArrowDown' || input.key === 'PageDown' || input.key === 'End') {
        return 'towardBottom'
    }
    if (input.key === ' ') {
        return input.shiftKey ? 'awayFromBottom' : 'towardBottom'
    }
    return 'none'
}

export type ScrollEventSource = 'user' | 'programmatic' | 'layout'

/**
 * scroll 事件来源裁决。用户输入优先；其余 scroll 若是程序化贴底的回声算 programmatic，
 * 落在布局保护窗内算 layout，保护窗外的未分类事件按真实用户滚动处理
 * （兼容原生滚动条拖动和辅助技术）。
 */
export function classifyScrollSource(input: {
    userScrollIntent: UserScrollIntent
    programmatic: boolean
    withinLayoutGuard: boolean
}): ScrollEventSource {
    if (input.userScrollIntent !== 'none') return 'user'
    if (input.programmatic) return 'programmatic'
    if (input.withinLayoutGuard) return 'layout'
    return 'user'
}

/**
 * scroll 事件后的跟随态。布局/程序化 scroll 不得改变用户意图；
 * 只有用户滚动才按落点决定：落在底部 ⇔ 跟随。
 */
export function resolveFollowingAfterScroll(input: {
    following: boolean
    metrics: ScrollMetrics
    source: ScrollEventSource
    epsilonPx?: number
}): boolean {
    if (input.source !== 'user') return input.following
    return isAtBottom(input.metrics, input.epsilonPx)
}

/**
 * 内容变化贴底前，对账用户滚动意图。
 *
 * scroll 事件在滚动发生后的下一帧才派发：用户上滚之后、事件派发之前，若恰好碰上
 * 一次内容变化（流式 delta、测高修正、输入框高度变化），贴底会拿着过期的
 * following=true 把用户拽回底部，回弹落点又让随后的 scroll 事件把跟随判回 true，
 * 用户的上滚被整体吞掉。
 *
 * 对账规则（输入为贴底动作前的实时指标）：
 * 1. 明确向上滚动 → 立即解除跟随；
 * 2. 没有用户输入 → 原样保持 following，测高导致的 scrollTop 回退不算上滚；
 * 3. 方向未知或向下的用户输入 → 落点在底则恢复跟随，明显回退则解除，其余保持。
 */
export function reconcileFollowingForContentAnchor(input: {
    following: boolean
    metrics: ScrollMetrics
    /** 最近一次入账的 scrollTop（scroll 事件读取值或程序化写入后的回读值）。 */
    lastObservedScrollTop: number
    userScrollIntent: UserScrollIntent
    bottomEpsilonPx?: number
    scrollEpsilonPx?: number
}): boolean {
    if (input.userScrollIntent === 'awayFromBottom') return false
    if (input.userScrollIntent === 'none') return input.following
    if (isAtBottom(input.metrics, input.bottomEpsilonPx ?? BOTTOM_ANCHOR_EPSILON_PX)) {
        return true
    }
    const unobservedUpscroll =
        input.metrics.scrollTop <
        input.lastObservedScrollTop - (input.scrollEpsilonPx ?? UNOBSERVED_SCROLL_EPSILON_PX)
    if (unobservedUpscroll) return false
    return input.following
}

/** 内容变化后的动作：跟随中 → 贴底；已解除 → 保持阅读位置（绝不拉回）。 */
export function anchorActionAfterContentChange(following: boolean): 'stickToBottom' | 'hold' {
    return following ? 'stickToBottom' : 'hold'
}

// ===================== 程序化贴底的收敛 =====================
//
// 虚拟列表里 scrollHeight 是估算值：视口外的消息只有估高，真实高度要等渲染后测量。
// 一次性的 scrollTo(scrollHeight) 因此必然瞄不准——边滚边测高，落点就短了。
// 「贴底锁」把这趟程序化滚动做成有始有终的过程：每帧重新对齐底部，直到内容高度
// 连续若干帧不再变化且确实到底，或者超时，或者用户自己接管了滚动。

/** 贴底锁的兜底时长：超过就放手，避免内容一直在长时锁死 rAF。 */
export const BOTTOM_SETTLE_TIMEOUT_MS = 2000

/** 内容高度连续这么多帧不变，才认为虚拟列表测高结束。 */
export const BOTTOM_SETTLE_STABLE_FRAMES = 3

/**
 * smooth 动画的最大距离，单位是视口高度。
 * 超过它说明途中大量消息还没测高，动画一定瞄不准，直接瞬时贴底更可靠。
 */
export const SMOOTH_SCROLL_MAX_DISTANCE_RATIO = 1.5

/** 距离够近时才值得做 smooth 动画：此时途经内容已经渲染过，scrollHeight 可信。 */
export function shouldAnimateScrollToBottom(
    metrics: ScrollMetrics,
    maxDistanceRatio: number = SMOOTH_SCROLL_MAX_DISTANCE_RATIO
): boolean {
    return distanceToBottom(metrics) <= metrics.viewportHeight * maxDistanceRatio
}

export type BottomSettleAction =
    /** 结束贴底锁 */
    | 'stop'
    /** 立即同步写 scrollTop 贴底 */
    | 'stick'
    /** 内容长高了，smooth 动画的落点已过期，重新瞄准新的底部 */
    | 'retarget'
    /** 让 smooth 动画自己跑，本帧不插手 */
    | 'hold'

/**
 * 贴底锁每帧的动作。
 *
 * - 跟随权被用户拿走（上滚、拖滚动条离底）→ 立刻放手，绝不把人拽回来；
 * - 超时 → 放手，避免持续输出的会话把锁一直续下去；
 * - 内容高度变了 → smooth 期间重新瞄准，否则直接贴底；
 * - 高度稳定且已到底 → 收敛，解锁。
 */
export function bottomSettleAction(input: {
    /** 跟随权。任何真实用户滚动都会把它置 false */
    following: boolean
    metrics: ScrollMetrics
    /** 上一帧记下的内容高度 */
    lastContentHeight: number
    /** 到上一帧为止，内容高度已经连续多少帧没变 */
    stableFrames: number
    /** 浏览器的 smooth 动画是否还在窗口期内 */
    smoothActive: boolean
    /** 从加锁到现在经过的毫秒数 */
    elapsedMs: number
    bottomEpsilonPx?: number
    timeoutMs?: number
    stableFramesToSettle?: number
}): BottomSettleAction {
    if (!input.following) return 'stop'
    if (input.elapsedMs > (input.timeoutMs ?? BOTTOM_SETTLE_TIMEOUT_MS)) return 'stop'

    const epsilonPx = input.bottomEpsilonPx ?? BOTTOM_ANCHOR_EPSILON_PX
    if (input.metrics.contentHeight !== input.lastContentHeight) {
        return input.smoothActive ? 'retarget' : 'stick'
    }

    const stableFrames = input.stableFrames + 1
    const settled = stableFrames >= (input.stableFramesToSettle ?? BOTTOM_SETTLE_STABLE_FRAMES)
    if (settled && isAtBottom(input.metrics, epsilonPx)) return 'stop'
    return input.smoothActive ? 'hold' : 'stick'
}
