import { useCallback, useEffect, useRef } from 'react'

/**
 * useSmoothMarkdownStream
 * - 使用 Intl.Segmenter（可降级）做分词/字符切分
 * - 通过 requestAnimationFrame 逐帧合并，减少 remark/rehype 在流式中的抖动
 */
export function useSmoothMarkdownStream(options: {
    onUpdate: (text: string) => void
    streamDone: boolean
    minDelay?: number
    initialText?: string
}) {
    const { onUpdate, streamDone, minDelay = 10, initialText = '' } = options

    const queueRef = useRef<string[]>([])
    const rafRef = useRef<number | null>(null)
    const textRef = useRef<string>(initialText)
    const lastUpdateRef = useRef<number>(0)

    const segment = useCallback((chunk: string) => {
        // 优先使用 Intl.Segmenter（语言组合尽量覆盖中英）
        // 不存在时降级为 code point 拆分
        const hasSegmenter = typeof (globalThis as any).Intl?.Segmenter === 'function'
        if (hasSegmenter) {
            const segmenter = new (globalThis as any).Intl.Segmenter(['zh-CN', 'en-US'])
            return Array.from(segmenter.segment(chunk)).map((s: any) => s.segment as string)
        }
        return Array.from(chunk)
    }, [])

    const addChunk = useCallback(
        (chunk: string) => {
            if (!chunk) return
            queueRef.current = [...queueRef.current, ...segment(chunk)]
        },
        [segment]
    )

    const loop = useCallback(
        (ts: number) => {
            // 队列空
            if (queueRef.current.length === 0) {
                if (!streamDone) {
                    rafRef.current = requestAnimationFrame(loop)
                }
                return
            }

            // 控制最小间隔
            if (ts - lastUpdateRef.current < minDelay) {
                rafRef.current = requestAnimationFrame(loop)
                return
            }
            lastUpdateRef.current = ts

            // 动态批量合并（流结束时一次性输出）
            const count = streamDone
                ? queueRef.current.length
                : Math.max(1, Math.floor(queueRef.current.length / 5))
            const slice = queueRef.current.slice(0, count)
            queueRef.current = queueRef.current.slice(count)
            textRef.current += slice.join('')
            onUpdate(textRef.current)

            if (queueRef.current.length > 0 || !streamDone) {
                rafRef.current = requestAnimationFrame(loop)
            }
        },
        [minDelay, streamDone, onUpdate]
    )

    const reset = useCallback(
        (newText = '') => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
            rafRef.current = null
            queueRef.current = []
            textRef.current = newText
            lastUpdateRef.current = 0
            onUpdate(newText)
            // reset 可能发生在流式过程中：需要确保循环会继续跑起来
            if (!streamDone) {
                rafRef.current = requestAnimationFrame(loop)
            }
        },
        [onUpdate, streamDone, loop]
    )

    useEffect(() => {
        rafRef.current = requestAnimationFrame(loop)
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
        }
    }, [loop])

    return { addChunk, reset }
}
