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

    const onUpdateRef = useRef(onUpdate)
    const streamDoneRef = useRef(streamDone)
    const minDelayRef = useRef(minDelay)
    const segmenterRef = useRef<any>(null)

    useEffect(() => {
        onUpdateRef.current = onUpdate
    }, [onUpdate])

    useEffect(() => {
        streamDoneRef.current = streamDone
    }, [streamDone])

    useEffect(() => {
        minDelayRef.current = minDelay
    }, [minDelay])

    const segment = useCallback((chunk: string) => {
        // 优先使用 Intl.Segmenter（语言组合尽量覆盖中英）；不存在时降级为 code point 拆分
        const Segmenter = (globalThis as any).Intl?.Segmenter
        if (typeof Segmenter === 'function') {
            if (!segmenterRef.current) {
                segmenterRef.current = new Segmenter(['zh-CN', 'en-US'])
            }
            return Array.from(segmenterRef.current.segment(chunk)).map((s: any) => s.segment as string)
        }
        return Array.from(chunk)
    }, [])

    const loop = useCallback((ts: number) => {
        // 本帧开始，先把「已安排的下一帧」标记清空，避免外部 addChunk/reset 无法正确判断是否需要启动循环。
        rafRef.current = null

        // 队列空：停止（等待 addChunk 重新唤醒）
        if (queueRef.current.length === 0) {
            return
        }

        const minDelayMs = minDelayRef.current
        if (ts - lastUpdateRef.current < minDelayMs) {
            rafRef.current = requestAnimationFrame(loop)
            return
        }
        lastUpdateRef.current = ts

        // 动态批量合并（流结束时一次性输出）
        const done = streamDoneRef.current
        const count = done
            ? queueRef.current.length
            : Math.max(1, Math.floor(queueRef.current.length / 5))
        const slice = queueRef.current.slice(0, count)
        queueRef.current = queueRef.current.slice(count)
        textRef.current += slice.join('')
        onUpdateRef.current(textRef.current)

        if (queueRef.current.length > 0) {
            rafRef.current = requestAnimationFrame(loop)
        }
    }, [])

    const addChunk = useCallback(
        (chunk: string) => {
            if (!chunk) return
            queueRef.current.push(...segment(chunk))
            if (rafRef.current == null) {
                rafRef.current = requestAnimationFrame(loop)
            }
        },
        [segment, loop]
    )

    const reset = useCallback(
        (newText = '') => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
            rafRef.current = null
            queueRef.current = []
            textRef.current = newText
            lastUpdateRef.current = 0
            onUpdateRef.current(newText)
        },
        []
    )

    useEffect(() => {
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
        }
    }, [])

    return { addChunk, reset }
}
