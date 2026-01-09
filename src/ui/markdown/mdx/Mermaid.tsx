import React, { useEffect, useMemo, useRef, useState, useId } from 'react'

type MermaidModule = {
    default?: any
}

let mermaidPromise: Promise<any> | null = null
let mermaidInitialized = false

async function getMermaid() {
    if (!mermaidPromise) {
        mermaidPromise = import('mermaid') as Promise<MermaidModule>
    }

    const mod = await mermaidPromise
    const mermaid = (mod as any).default ?? mod

    if (!mermaidInitialized) {
        mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            markdownAutoWrap: true,
            suppressErrorRendering: true
        })
        mermaidInitialized = true
    }

    return mermaid
}

export interface MermaidDiagramProps {
    code: string
    streaming?: boolean
}

/**
 * Mermaid 图表渲染组件（面向流式场景）
 *
 * - 通过 debounce 限制频率，避免每个字符都触发重渲染
 * - Mermaid 语法尚未完整时保留上一次成功的 SVG（或显示代码）
 */
export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ code, streaming = false }) => {
    const reactId = useId()
    const mermaidId = useMemo(() => `mermaid-${reactId.replaceAll(':', '_')}`, [reactId])

    const containerRef = useRef<HTMLDivElement | null>(null)
    const bindFunctionsRef = useRef<((element: Element) => void) | null>(null)

    const [svg, setSvg] = useState<string>('')
    const [errorText, setErrorText] = useState<string>('')

    const lastRenderedCodeRef = useRef<string>('')
    const renderSeqRef = useRef(0)
    const timerRef = useRef<number | null>(null)

    useEffect(() => {
        const normalized = (code ?? '').replace(/\n+$/, '\n')
        if (!normalized.trim()) {
            setSvg('')
            setErrorText('')
            lastRenderedCodeRef.current = ''
            return
        }

        if (normalized === lastRenderedCodeRef.current) {
            return
        }

        renderSeqRef.current += 1
        const seq = renderSeqRef.current

        const delay = streaming ? 120 : 0
        if (timerRef.current != null) {
            window.clearTimeout(timerRef.current)
        }

        timerRef.current = window.setTimeout(() => {
            ;(async () => {
                try {
                    const mermaid = await getMermaid()
                    const result = await mermaid.render(mermaidId, normalized)

                    if (renderSeqRef.current !== seq) return

                    const nextSvg = result?.svg ? String(result.svg) : ''
                    if (!nextSvg) {
                        throw new Error('Mermaid 渲染返回空 SVG')
                    }

                    bindFunctionsRef.current =
                        typeof result?.bindFunctions === 'function' ? result.bindFunctions : null
                    setSvg(nextSvg)
                    setErrorText('')
                    lastRenderedCodeRef.current = normalized
                } catch (error) {
                    if (renderSeqRef.current !== seq) return

                    // 流式中 Mermaid 语法经常处于「半成品」状态：不打断 UI，只在结束后展示错误
                    if (!streaming) {
                        setErrorText(error instanceof Error ? error.message : String(error))
                    } else {
                        setErrorText('')
                    }
                }
            })()
        }, delay)

        return () => {
            // 组件卸载/依赖变更：标记当前渲染失效，避免异步回调对已卸载组件 setState
            renderSeqRef.current += 1
            if (timerRef.current != null) {
                window.clearTimeout(timerRef.current)
                timerRef.current = null
            }
        }
    }, [code, mermaidId, streaming])

    useEffect(() => {
        if (!svg) return
        const container = containerRef.current
        const bind = bindFunctionsRef.current
        if (!container || !bind) return
        try {
            bind(container)
        } catch {
            // 忽略绑定事件失败：不影响静态 SVG 展示
        }
    }, [svg])

    if (svg) {
        return (
            <div ref={containerRef} data-mermaid-block="true" className="mermaid-wrapper">
                <div dangerouslySetInnerHTML={{ __html: svg }} />
            </div>
        )
    }

    return (
        <div data-mermaid-block="true" className="mermaid-wrapper">
            <pre>{streaming ? 'Mermaid 图表生成中…' : errorText ? `渲染失败：${errorText}` : 'Mermaid 图表生成中…'}</pre>
            <pre>{code}</pre>
        </div>
    )
}

export default MermaidDiagram
