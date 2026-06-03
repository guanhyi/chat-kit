import React, { useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronUp, Sparkle } from 'lucide-react'
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

export interface ActivitySummaryBlockProps {
    blocks?: Block[] | null
    docs?: CitationItem[] | null
    loading?: boolean
    className?: string
}

export const ActivitySummaryBlock: React.FC<ActivitySummaryBlockProps> = ({
    blocks = [],
    docs = [],
    loading,
    className
}) => {
    const [open, setOpen] = useState(false)
    const detailsId = useId()
    const activityBlocks = getActivityBlocks(blocks)
    const citationDocs = getCitationDocs(activityBlocks, docs)
    const hasCitationBlock = activityBlocks.some((block) => block.type === 'citation')
    const summary = getActivitySummary(blocks, { docs, loading })
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
                    'group flex min-h-8 w-full max-w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] leading-5 text-gray-500 transition-colors',
                    'hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4376FD]/30'
                )}
                onClick={() => setOpen((value) => !value)}
            >
                <span className="flex size-5 shrink-0 items-center justify-center">
                    <Sparkle
                        size={14}
                        className={clsx(
                            'text-[#4376FD]',
                            summary.isStreaming && 'animate-spin motion-reduce:animate-none'
                        )}
                    />
                </span>
                <span className="min-w-0 flex-1 truncate">{typedText}</span>
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
                            />
                        )
                    })}
                    {!hasCitationBlock && citationDocs.length > 0 ? (
                        <CitationBlock docs={citationDocs} />
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

export default ActivitySummaryBlock
