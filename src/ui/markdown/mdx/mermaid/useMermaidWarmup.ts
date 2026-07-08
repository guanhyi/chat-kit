import { useEffect } from 'react'
import type { MermaidConfig } from 'mermaid'
import MermaidService from './mermaidService'

const WARMUP_CODE = 'graph TD\nA-->B'
const WARMUP_ID = 'mermaid-warmup'

const defaultWarmupConfig: MermaidConfig = {
    startOnLoad: false,
    flowchart: { useMaxWidth: true, htmlLabels: true },
    suppressErrorRendering: true
}

let warmupPromise: Promise<void> | null = null

export function warmupMermaid(config: MermaidConfig = defaultWarmupConfig) {
    if (warmupPromise) return warmupPromise

    warmupPromise = (async () => {
        const mermaidService = MermaidService.getInstance()

        await mermaidService.initialize(config)
        await mermaidService.parse(WARMUP_CODE)
        await mermaidService.render(WARMUP_ID, WARMUP_CODE)
    })().catch((error) => {
        warmupPromise = null
        console.warn('[mermaid] warmup failed:', error)
    })

    return warmupPromise
}

type IdleWindow = Window & {
    requestIdleCallback?: (
        callback: () => void,
        options?: { timeout?: number }
    ) => number
    cancelIdleCallback?: (handle: number) => void
}

export function useMermaidWarmup(config?: MermaidConfig) {
    useEffect(() => {
        if (typeof window === 'undefined') return

        const idleWindow = window as IdleWindow
        const runWarmup = () => {
            void warmupMermaid(config)
        }

        if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
            const idleId = idleWindow.requestIdleCallback(runWarmup, { timeout: 2000 })
            return () => {
                idleWindow.cancelIdleCallback?.(idleId)
            }
        }

        const timer = window.setTimeout(runWarmup, 800)
        return () => {
            window.clearTimeout(timer)
        }
    }, [config])
}
