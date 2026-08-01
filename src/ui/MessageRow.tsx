import React, { useEffect, useRef } from 'react'

const SIZE_EPSILON = 0.5

export interface MessageRowProps {
    messageKey: string
    className?: string
    onLayoutChange?: (messageKey: string) => void
    children: React.ReactNode
}

export const MessageRow: React.FC<MessageRowProps> = ({
    messageKey,
    className,
    onLayoutChange,
    children
}) => {
    const rootRef = useRef<HTMLDivElement | null>(null)
    const frameRef = useRef<number | null>(null)
    const sizeRef = useRef<{ width: number; height: number } | null>(null)

    useEffect(() => {
        return () => {
            if (frameRef.current != null) {
                cancelAnimationFrame(frameRef.current)
            }
        }
    }, [])

    useEffect(() => {
        const root = rootRef.current
        if (!root || typeof ResizeObserver === 'undefined') {
            return
        }

        const notifyLayoutChange = () => {
            if (frameRef.current != null) {
                return
            }
            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = null
                onLayoutChange?.(messageKey)
            })
        }

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0]
            if (!entry) {
                return
            }

            const nextWidth = entry.contentRect.width
            const nextHeight = entry.contentRect.height
            const prevSize = sizeRef.current
            sizeRef.current = { width: nextWidth, height: nextHeight }

            if (
                !prevSize ||
                Math.abs(prevSize.width - nextWidth) > SIZE_EPSILON ||
                Math.abs(prevSize.height - nextHeight) > SIZE_EPSILON
            ) {
                notifyLayoutChange()
            }
        })

        observer.observe(root)

        return () => {
            observer.disconnect()
        }
    }, [messageKey, onLayoutChange])

    return (
        <div ref={rootRef} className={className} style={{ minWidth: 0 }}>
            {children}
        </div>
    )
}

export default MessageRow
