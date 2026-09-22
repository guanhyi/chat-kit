import React, { useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronUp, Sparkle } from 'lucide-react'
import styled, { css, keyframes } from 'styled-components'
import type { Block } from '../../types'
import { CitationBlock } from './CitationBlock'
import type { CitationItem } from './CitationBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolBlock } from './ToolBlock'
import {
    ACTIVITY_TEXT_TYPE_INTERVAL_MS,
    ACTIVITY_TEXT_TYPE_STEP,
    ACTIVITY_TEXT_THROTTLE_MS,
    getActivityBlocks,
    getActivitySummary,
    getCitationDocs,
    getNextActivityTextDisplay,
    getNextTypedActivityText,
    toBlockStatus
} from './ActivitySummaryBlock.utils'
export { getActivitySummary } from './ActivitySummaryBlock.utils'

const ACTIVITY_TEXT_SWITCH_MS = 180

const activityTextEnter = keyframes`
    from {
        opacity: 0;
        transform: translateY(55%);
        filter: blur(2px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
        filter: blur(0);
    }
`

const activityTextExit = keyframes`
    from {
        opacity: 1;
        transform: translateY(0);
        filter: blur(0);
    }
    to {
        opacity: 0;
        transform: translateY(-70%);
        filter: blur(2px);
    }
`

const ActivityTextViewport = styled.span`
    position: relative;
    display: block;
    min-width: 0;
    /* 0% basis：在父级宽度确定时吃掉剩余空间；同时靠 sizer 提供 min-content，避免绝对定位把整条挤成 0 宽 */
    flex: 1 1 0%;
    overflow: hidden;
`

/**
 * 占位文案：参与正常文档流，负责撑开高度/最小宽度。
 * 动画层是 absolute，本身不会贡献 intrinsic width，没有这层会在 shrink-to-fit 场景塌成空条。
 */
const ActivityTextSizer = styled.span`
    display: block;
    height: 1.25rem;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    visibility: hidden;
    pointer-events: none;
`

const ActivityTextLine = styled.span<{ $state: 'stable' | 'enter' | 'exit' }>`
    position: absolute;
    inset: 0;
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    will-change: transform, opacity, filter;

    ${({ $state }) =>
        $state === 'enter' &&
        css`
            animation: ${activityTextEnter} ${ACTIVITY_TEXT_SWITCH_MS}ms cubic-bezier(0.2, 0, 0, 1)
                both;
        `}

    ${({ $state }) =>
        $state === 'exit' &&
        css`
            animation: ${activityTextExit} ${ACTIVITY_TEXT_SWITCH_MS}ms cubic-bezier(0.4, 0, 1, 1)
                both;
        `}

    @media (prefers-reduced-motion: reduce) {
        animation: none;
        transform: none;
        opacity: 1;
        filter: none;
    }
`

const AnimatedActivityText = ({ text, animationKey }: { text: string; animationKey: string }) => {
    const previousTextRef = useRef(text)
    const previousKeyRef = useRef(animationKey)
    const exitTimerRef = useRef<number | null>(null)
    const [exitingText, setExitingText] = useState<string | null>(null)
    // 用目标全文撑开宽度，避免打字过程中条宽跟着逐字抖动
    const sizerText = animationKey || text

    useEffect(() => {
        return () => {
            if (exitTimerRef.current != null) {
                window.clearTimeout(exitTimerRef.current)
            }
        }
    }, [])

    useEffect(() => {
        if (animationKey === previousKeyRef.current) {
            previousTextRef.current = text
            return
        }

        if (exitTimerRef.current != null) {
            window.clearTimeout(exitTimerRef.current)
        }

        setExitingText(previousTextRef.current)
        previousKeyRef.current = animationKey
        previousTextRef.current = text
        exitTimerRef.current = window.setTimeout(() => {
            exitTimerRef.current = null
            setExitingText(null)
        }, ACTIVITY_TEXT_SWITCH_MS)
    }, [animationKey, text])

    return (
        <ActivityTextViewport aria-live="polite">
            <ActivityTextSizer aria-hidden>{sizerText}</ActivityTextSizer>
            {exitingText ? (
                <ActivityTextLine key={`exit-${animationKey}`} $state="exit" aria-hidden>
                    {exitingText}
                </ActivityTextLine>
            ) : null}
            <ActivityTextLine key={animationKey} $state={exitingText ? 'enter' : 'stable'}>
                {text}
            </ActivityTextLine>
        </ActivityTextViewport>
    )
}

export interface ActivitySummaryBlockProps {
    blocks?: Block[] | null
    docs?: CitationItem[] | null
    loading?: boolean
    className?: string
    showReferences?: boolean
    open?: boolean
    defaultOpen?: boolean
    onOpenChange?: (open: boolean) => void
}

export const ActivitySummaryBlock: React.FC<ActivitySummaryBlockProps> = ({
    blocks = [],
    docs = [],
    loading,
    className,
    showReferences = true,
    open: controlledOpen,
    defaultOpen = false,
    onOpenChange
}) => {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
    const open = controlledOpen ?? uncontrolledOpen
    const detailsId = useId()
    const safeBlocks = Array.isArray(blocks) ? blocks : []
    const safeDocs = Array.isArray(docs) ? docs : []
    const visibleBlocks = showReferences
        ? safeBlocks
        : safeBlocks.filter((block) => block.type !== 'citation')
    const visibleDocs = showReferences ? safeDocs : []
    const activityBlocks = getActivityBlocks(visibleBlocks)
    const citationDocs = getCitationDocs(activityBlocks, visibleDocs)
    const hasCitationBlock = activityBlocks.some((block) => block.type === 'citation')
    const summary = getActivitySummary(visibleBlocks, { docs: visibleDocs, loading })
    const latestSummaryRef = useRef({
        text: summary.text,
        isStreaming: summary.isStreaming
    })
    const timeoutRef = useRef<number | null>(null)
    const typeTimeoutRef = useRef<number | null>(null)
    const [displayState, setDisplayState] = useState(() => ({
        text: summary.text,
        updatedAt: Date.now()
    }))
    const [typedText, setTypedText] = useState(summary.text)
    const setOpen = (nextOpen: boolean) => {
        if (controlledOpen === undefined) {
            setUncontrolledOpen(nextOpen)
        }
        onOpenChange?.(nextOpen)
    }

    useEffect(() => {
        return () => {
            if (timeoutRef.current != null) {
                window.clearTimeout(timeoutRef.current)
            }
            if (typeTimeoutRef.current != null) {
                window.clearTimeout(typeTimeoutRef.current)
            }
        }
    }, [])

    useEffect(() => {
        latestSummaryRef.current = {
            text: summary.text,
            isStreaming: summary.isStreaming
        }

        setDisplayState((current) => {
            const next = getNextActivityTextDisplay(current, summary.text, {
                isStreaming: summary.isStreaming,
                now: Date.now()
            })

            if (next.remainingMs === 0) {
                if (timeoutRef.current != null) {
                    window.clearTimeout(timeoutRef.current)
                    timeoutRef.current = null
                }
                return next.state
            }

            if (timeoutRef.current == null) {
                timeoutRef.current = window.setTimeout(() => {
                    timeoutRef.current = null
                    const latest = latestSummaryRef.current
                    setDisplayState((scheduledCurrent) => {
                        return getNextActivityTextDisplay(scheduledCurrent, latest.text, {
                            isStreaming: latest.isStreaming,
                            now: Date.now(),
                            throttleMs: ACTIVITY_TEXT_THROTTLE_MS
                        }).state
                    })
                }, next.remainingMs)
            }

            return current
        })
    }, [summary.text, summary.isStreaming])

    useEffect(() => {
        if (!summary.isStreaming) {
            if (typeTimeoutRef.current != null) {
                window.clearTimeout(typeTimeoutRef.current)
                typeTimeoutRef.current = null
            }
            setTypedText(displayState.text)
            return
        }

        if (typedText === displayState.text || typeTimeoutRef.current != null) {
            return
        }

        typeTimeoutRef.current = window.setTimeout(() => {
            typeTimeoutRef.current = null
            setTypedText((current) => {
                return getNextTypedActivityText(current, displayState.text, ACTIVITY_TEXT_TYPE_STEP)
            })
        }, ACTIVITY_TEXT_TYPE_INTERVAL_MS)
    }, [displayState.text, summary.isStreaming, typedText])

    if (!summary.hasDetails) {
        return null
    }

    return (
        <div className={clsx('w-full', className)}>
            <button
                type="button"
                aria-expanded={open}
                aria-controls={detailsId}
                className={clsx(
                    'group flex min-h-8 w-full max-w-full items-center gap-2 rounded-md py-1 text-left text-[13px] leading-5 text-gray-700 transition-colors',
                    'hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4376FD]/30'
                )}
                onClick={() => setOpen(!open)}
            >
                <AnimatedActivityText text={typedText} animationKey={displayState.text} />
                <span className="ml-auto flex size-5 shrink-0 items-center justify-center">
                    <Sparkle
                        size={14}
                        className={clsx(
                            'text-[#4376FD]',
                            summary.isStreaming && 'animate-spin motion-reduce:animate-none'
                        )}
                    />
                </span>
                <span className="flex size-5 shrink-0 items-center justify-center text-gray-400">
                    {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </span>
            </button>
            {open ? (
                <div id={detailsId} className="mt-2 space-y-2">
                    {activityBlocks.map((block) => {
                        if (block.type === 'thinking') {
                            return (
                                <ThinkingBlock
                                    key={block.id}
                                    content={block.content || ''}
                                    status={toBlockStatus(block.status)}
                                />
                            )
                        }

                        if (block.type === 'tool') {
                            return (
                                <ToolBlock
                                    key={block.id}
                                    toolName={block.toolName || 'unknown'}
                                    content={block.content || ''}
                                    status={toBlockStatus(block.status)}
                                />
                            )
                        }

                        return (
                            <CitationBlock
                                key={block.id}
                                docs={
                                    ((block.docs?.length ? block.docs : citationDocs) as
                                        | CitationItem[]
                                        | undefined) || []
                                }
                                showReferences={showReferences}
                            />
                        )
                    })}
                    {showReferences && !hasCitationBlock && citationDocs.length > 0 ? (
                        <CitationBlock docs={citationDocs} showReferences={showReferences} />
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

export default ActivitySummaryBlock
