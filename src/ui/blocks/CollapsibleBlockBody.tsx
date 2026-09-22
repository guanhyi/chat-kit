import React, { useEffect, useRef, useState } from 'react'

const MANUAL_COLLAPSE_MS = 180
const FINISH_COLLAPSE_MS = 90

/**
 * 过程块的展开内容。
 * 流式中保持展开；流一结束按较短时长收起，而不是整块直接消失。
 * 用户手动开关走稍慢的时长。结束后如果用户又打开，不再自动收起。
 */
export const CollapsibleBlockBody: React.FC<{
    open: boolean
    streaming: boolean
    children: React.ReactNode
}> = ({ open, streaming, children }) => {
    const bodyRef = useRef<HTMLDivElement | null>(null)
    const [height, setHeight] = useState<number | 'auto'>(open ? 'auto' : 0)
    const [mounted, setMounted] = useState(open || streaming)
    const wasStreamingRef = useRef(streaming)

    useEffect(() => {
        const body = bodyRef.current
        if (!body) return
        if (open || streaming) {
            setMounted(true)
            const next = body.scrollHeight
            setHeight(next)
            return
        }

        const finishing = wasStreamingRef.current
        wasStreamingRef.current = false
        const duration = finishing ? FINISH_COLLAPSE_MS : MANUAL_COLLAPSE_MS
        setHeight(body.scrollHeight)
        const frame = requestAnimationFrame(() => setHeight(0))
        const timer = window.setTimeout(() => setMounted(false), duration)
        return () => {
            cancelAnimationFrame(frame)
            window.clearTimeout(timer)
        }
    }, [open, streaming])

    useEffect(() => {
        wasStreamingRef.current = streaming
    }, [streaming])

    if (!mounted && !open) return null

    const duration = wasStreamingRef.current ? FINISH_COLLAPSE_MS : MANUAL_COLLAPSE_MS

    return (
        <div
            style={{
                height,
                overflow: 'hidden',
                transition: streaming ? undefined : `height ${duration}ms ease`
            }}
        >
            <div ref={bodyRef}>{children}</div>
        </div>
    )
}
