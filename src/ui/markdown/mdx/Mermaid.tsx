import React, { useCallback, useEffect, useMemo, useRef, useState, useId } from 'react'
import {
    Check,
    ChevronDown,
    ChevronUp,
    Code2,
    Copy,
    Download,
    Eye,
    Maximize2,
    Minimize2,
    RotateCcw,
    X,
    ZoomIn,
    ZoomOut
} from 'lucide-react'

type MermaidModule = typeof import('mermaid')

let mermaidModulePromise: Promise<MermaidModule> | null = null
let mermaidInitialized = false

const SAFE_URL_PROTOCOLS = /^(?:https?:|mailto:|tel:|#|\/|data:image\/(?:png|gif|jpe?g|webp);)/i
const DISALLOWED_STYLE_PATTERNS = [/javascript:/i, /expression\s*\(/i, /url\s*\(\s*javascript:/i, /@import/i]

async function getMermaid() {
    if (!mermaidModulePromise) {
        mermaidModulePromise = import('mermaid')
    }
    const mod = await mermaidModulePromise
    const instance = (mod as any)?.default ?? (mod as any)
    if (!instance) {
        throw new Error('Mermaid 模块加载失败')
    }

    if (!mermaidInitialized && typeof instance?.initialize === 'function') {
        instance.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            markdownAutoWrap: true,
            suppressErrorRendering: true,
            flowchart: { htmlLabels: false }
        })
        mermaidInitialized = true
    }

    return instance as any
}

function neutralizeScriptProtocols(raw: string) {
    return raw
        .replace(/["']\s*javascript:/gi, '#')
        .replace(/\bjavascript:/gi, '#')
        .replace(/["']\s*vbscript:/gi, '#')
        .replace(/\bvbscript:/gi, '#')
        .replace(/\bdata:text\/html/gi, '#')
}

function sanitizeUrl(value: string | null | undefined) {
    if (!value) return ''
    const trimmed = value.trim()
    if (SAFE_URL_PROTOCOLS.test(trimmed)) return trimmed
    return ''
}

function scrubSvgElement(svgEl: SVGElement) {
    const forbiddenTags = new Set(['script'])
    const nodes = [svgEl as Element, ...Array.from(svgEl.querySelectorAll('*'))]
    for (const node of nodes) {
        if (forbiddenTags.has(node.tagName.toLowerCase())) {
            node.remove()
            continue
        }

        const attrs = Array.from(node.attributes)
        for (const attr of attrs) {
            const name = attr.name
            if (/^on/i.test(name)) {
                node.removeAttribute(name)
                continue
            }

            if (name === 'style' && attr.value) {
                const val = attr.value
                if (DISALLOWED_STYLE_PATTERNS.some((re) => re.test(val))) {
                    node.removeAttribute(name)
                    continue
                }
            }

            if ((name === 'href' || name === 'xlink:href') && attr.value) {
                const safe = sanitizeUrl(attr.value)
                if (!safe) {
                    node.removeAttribute(name)
                    continue
                }
                if (safe !== attr.value) node.setAttribute(name, safe)
            }
        }
    }

    // 额外防护：style 标签内容若包含明显危险模式则移除
    for (const styleEl of Array.from(svgEl.querySelectorAll('style'))) {
        const css = styleEl.textContent || ''
        if (DISALLOWED_STYLE_PATTERNS.some((re) => re.test(css))) {
            styleEl.remove()
        }
    }
}

function toSafeSvgString(svg: string | null | undefined): string {
    if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return ''
    if (!svg) return ''

    const neutralized = neutralizeScriptProtocols(svg)
    const parsed = new DOMParser().parseFromString(neutralized, 'image/svg+xml')
    const svgEl = parsed.documentElement
    if (!svgEl || svgEl.nodeName.toLowerCase() !== 'svg') return ''
    const svgElement = svgEl as unknown as SVGElement
    scrubSvgElement(svgElement)
    return svgElement.outerHTML || ''
}

function applyThemeTo(code: string, theme: 'light' | 'dark') {
    const themeValue = theme === 'dark' ? 'dark' : 'default'
    const themeConfig = `%%{init: {\"theme\": \"${themeValue}\"}}%%\n`
    const trimmed = code.trimStart()
    if (trimmed.startsWith('%%{')) return code
    return themeConfig + code
}

function trimTrailingEmptyLines(code: string) {
    const lines = code.split(/\r?\n/)
    while (lines.length > 0 && !lines[lines.length - 1].trim()) {
        lines.pop()
    }
    return lines
}

async function canParseMermaid(mermaid: any, code: string, theme: 'light' | 'dark') {
    try {
        if (!mermaid || typeof mermaid.parse !== 'function') return false
        const res = await mermaid.parse(applyThemeTo(code, theme), { suppressErrors: true })
        return !!res
    } catch {
        return false
    }
}

async function findParseablePrefixByLines(
    mermaid: any,
    fullCode: string,
    theme: 'light' | 'dark',
    options: { isStale?: () => boolean; maxAttempts?: number; maxMs?: number; requireTrim?: boolean } = {}
) {
    const { isStale, maxAttempts = 28, maxMs = 220, requireTrim = false } = options
    const startedAt = Date.now()

    const safeCandidate = getSafePrefixCandidate(fullCode)
    const lines = trimTrailingEmptyLines(safeCandidate)
    if (!lines.length) return null

    let attempts = 0
    const shouldRequireTrim = requireTrim && safeCandidate === fullCode
    const startEnd = shouldRequireTrim ? Math.max(1, lines.length - 1) : lines.length

    for (let end = startEnd; end >= 1; end--) {
        if (isStale?.()) return null
        if (attempts >= maxAttempts) return null
        if (Date.now() - startedAt > maxMs) return null
        attempts++

        const candidate = lines.slice(0, end).join('\n').trimEnd()
        if (!candidate.trim()) continue

        const ok = await canParseMermaid(mermaid, candidate, theme)
        if (ok) return candidate
    }

    return null
}

// 参照 markstream-vue：启发式剪裁尾部不完整行，提高流式中可渲染概率
function getSafePrefixCandidate(code: string): string {
    const lines = code.split(/\r?\n/)
    while (lines.length > 0) {
        const lastRaw = lines[lines.length - 1]
        const last = lastRaw.trimEnd()
        if (last === '') {
            lines.pop()
            continue
        }

        const looksDangling =
            /^[-=~>|<\s]+$/.test(last.trim()) ||
            /(?:--|==|~~|->|<-|-\||-\)|-x|o-|\|-|\.-)\s*$/.test(last) ||
            /[-|><]$/.test(last) ||
            /(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt)\s*$/i.test(last)

        if (looksDangling) {
            lines.pop()
            continue
        }
        break
    }
    return lines.join('\n')
}

function useIsDark() {
    const [isDark, setIsDark] = useState(false)

    useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return

        const media = window.matchMedia?.('(prefers-color-scheme: dark)')
        const update = () => {
            const byClass = document.documentElement.classList.contains('dark')
            const byMedia = media?.matches ?? false
            setIsDark(byClass || byMedia)
        }

        update()

        const onMediaChange = () => update()
        try {
            media?.addEventListener?.('change', onMediaChange)
        } catch {
            // ignore
        }

        const observer = new MutationObserver(() => update())
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

        return () => {
            try {
                media?.removeEventListener?.('change', onMediaChange)
            } catch {
                // ignore
            }
            observer.disconnect()
        }
    }, [])

    return isDark
}

async function copyToClipboard(text: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return
    }
    if (typeof document === 'undefined') return
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', 'true')
    el.style.position = 'fixed'
    el.style.left = '-9999px'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
}

export interface MermaidDiagramProps {
    code: string
    streaming?: boolean
    maxHeight?: number | string
}

/**
 * Mermaid 图表渲染组件（面向流式场景）
 *
 * 参考 markstream-vue 的 MermaidBlockNode：
 * - 流式中优先尝试完整渲染；失败时用「安全前缀」做渐进式预览
 * - SVG 输出做二次清洗，避免脚本协议 / on* 事件 / 危险样式注入
 * - 提供预览/源码切换、复制、导出 SVG、全屏、缩放等交互
 */
export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({
    code,
    streaming = false,
    maxHeight = 500
}) => {
    const reactId = useId()
    const baseId = useMemo(() => `mermaid-${reactId.replaceAll(':', '_')}`, [reactId])
    const isDark = useIsDark()

    const bindFunctionsRef = useRef<((element: Element) => void) | null>(null)
    const lastGoodSvgRef = useRef<string>('')
    const lastGoodCodeKeyRef = useRef<string>('')
    const lastGoodThemeRef = useRef<'light' | 'dark'>('light')

    const [safeSvg, setSafeSvg] = useState<string>('')
    const [errorText, setErrorText] = useState<string>('')
    const [isRendering, setIsRendering] = useState(false)
    const [isPartial, setIsPartial] = useState(false)

    const [showSource, setShowSource] = useState(false)
    const [collapsed, setCollapsed] = useState(false)
    const [modalOpen, setModalOpen] = useState(false)
    const [copied, setCopied] = useState(false)

    const [zoom, setZoom] = useState(1)
    const [translateX, setTranslateX] = useState(0)
    const [translateY, setTranslateY] = useState(0)
    const draggingRef = useRef<{
        pointerId: number
        startX: number
        startY: number
        startTx: number
        startTy: number
    } | null>(null)

    const renderSeqRef = useRef(0)
    const timerRef = useRef<number | null>(null)

    const normalizedCode = useMemo(() => {
        return (code ?? '').replace(/\n+$/, '\n')
    }, [code])

    const lastSeenCodeRef = useRef<string>(normalizedCode)
    const autoStreamingTimerRef = useRef<number | null>(null)
    const [autoStreaming, setAutoStreaming] = useState(false)

    // 外部没有正确传入 streaming 时：根据 code 是否持续变化来“自动判定流式中”
    useEffect(() => {
        if (typeof window === 'undefined') return

        if (streaming) {
            lastSeenCodeRef.current = normalizedCode
            if (autoStreamingTimerRef.current != null) {
                window.clearTimeout(autoStreamingTimerRef.current)
                autoStreamingTimerRef.current = null
            }
            setAutoStreaming(false)
            return
        }

        if (normalizedCode !== lastSeenCodeRef.current) {
            lastSeenCodeRef.current = normalizedCode
            setAutoStreaming(true)
            if (autoStreamingTimerRef.current != null) {
                window.clearTimeout(autoStreamingTimerRef.current)
            }
            autoStreamingTimerRef.current = window.setTimeout(() => {
                autoStreamingTimerRef.current = null
                setAutoStreaming(false)
            }, 800)
        }
    }, [normalizedCode, streaming])

    useEffect(() => {
        return () => {
            if (autoStreamingTimerRef.current != null) {
                window.clearTimeout(autoStreamingTimerRef.current)
                autoStreamingTimerRef.current = null
            }
        }
    }, [])

    const effectiveStreaming = streaming || autoStreaming

    const heightStyle = useMemo(() => {
        if (typeof maxHeight === 'number') return `${maxHeight}px`
        return maxHeight
    }, [maxHeight])

    const resetTransform = useCallback(() => {
        setZoom(1)
        setTranslateX(0)
        setTranslateY(0)
    }, [])

    const onCopy = useCallback(async () => {
        try {
            await copyToClipboard(code ?? '')
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
        } catch {
            // ignore
        }
    }, [code])

    const onExportSvg = useCallback(() => {
        if (typeof document === 'undefined') return
        const svgText = safeSvg || lastGoodSvgRef.current
        if (!svgText) return
        const content = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n${svgText}\n`
        const blob = new Blob([content], { type: 'image/svg+xml;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'mermaid.svg'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }, [safeSvg])

    const onZoomIn = useCallback(() => setZoom((z) => Math.min(4, Math.round((z + 0.1) * 10) / 10)), [])
    const onZoomOut = useCallback(
        () => setZoom((z) => Math.max(0.2, Math.round((z - 0.1) * 10) / 10)),
        []
    )

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return
        const el = e.currentTarget as HTMLElement
        try {
            el.setPointerCapture(e.pointerId)
        } catch {
            // ignore
        }
        draggingRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startTx: translateX,
            startTy: translateY
        }
    }, [translateX, translateY])

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        const drag = draggingRef.current
        if (!drag || drag.pointerId !== e.pointerId) return
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        setTranslateX(drag.startTx + dx)
        setTranslateY(drag.startTy + dy)
    }, [])

    const onPointerUp = useCallback((e: React.PointerEvent) => {
        const drag = draggingRef.current
        if (!drag || drag.pointerId !== e.pointerId) return
        draggingRef.current = null
        const el = e.currentTarget as HTMLElement
        try {
            el.releasePointerCapture(e.pointerId)
        } catch {
            // ignore
        }
    }, [])

    const renderSvg = useCallback(
        async (raw: string, opts: { seq: number; idSuffix: string; partial: boolean }) => {
            const mermaid = await getMermaid()
            const theme: 'light' | 'dark' = isDark ? 'dark' : 'light'
            const codeWithTheme = applyThemeTo(raw, theme)
            const result = await mermaid.render(`${baseId}-${opts.idSuffix}`, codeWithTheme)
            if (renderSeqRef.current !== opts.seq) return false

            const nextSvgRaw = result?.svg ? String(result.svg) : ''
            if (!nextSvgRaw) return false
            const nextSafeSvg = toSafeSvgString(nextSvgRaw)
            if (!nextSafeSvg) return false

            bindFunctionsRef.current =
                typeof result?.bindFunctions === 'function' ? result.bindFunctions : null

            setSafeSvg(nextSafeSvg)
            setIsPartial(opts.partial)
            setErrorText('')

            lastGoodSvgRef.current = nextSafeSvg
            lastGoodCodeKeyRef.current = raw.replace(/\s+/g, '')
            lastGoodThemeRef.current = theme
            return true
        },
        [baseId, isDark]
    )

    useEffect(() => {
        const normalized = normalizedCode
        const key = normalized.replace(/\s+/g, '')
        const theme: 'light' | 'dark' = isDark ? 'dark' : 'light'

        if (!normalized.trim()) {
            setSafeSvg('')
            setErrorText('')
            setIsPartial(false)
            lastGoodSvgRef.current = ''
            lastGoodCodeKeyRef.current = ''
            lastGoodThemeRef.current = theme
            return
        }

        // 内容未变更：避免重复渲染（theme 变化会触发 effect，因此这里要把 theme 纳入 key 判断之外）
        if (key && key === lastGoodCodeKeyRef.current && lastGoodThemeRef.current === theme && safeSvg) {
            return
        }

        renderSeqRef.current += 1
        const seq = renderSeqRef.current

        const delay = effectiveStreaming ? 220 : 0
        if (timerRef.current != null) {
            window.clearTimeout(timerRef.current)
        }

        timerRef.current = window.setTimeout(() => {
            ;(async () => {
                setIsRendering(true)
                try {
                    // 1) 优先尝试完整渲染
                    const okFull = await renderSvg(normalized, {
                        seq,
                        idSuffix: `full-${seq}`,
                        partial: false
                    })
                    if (okFull) return

                    // 2) 完整渲染失败：在流式阶段寻找「可解析前缀」做渐进式预览
                    if (effectiveStreaming) {
                        const mermaid = await getMermaid()
                        const prefix = await findParseablePrefixByLines(mermaid, normalized, theme, {
                            isStale: () => renderSeqRef.current !== seq,
                            requireTrim: true
                        })
                        if (prefix && prefix.trim()) {
                            // 只有当 prefix 比上一次成功渲染更“靠后”时才更新，避免明显回退
                            const prefixKey = prefix.replace(/\s+/g, '')
                            const lastKey = lastGoodCodeKeyRef.current
                            const allowUpgrade =
                                !lastKey || prefixKey.length >= lastKey.length || key.length < lastKey.length
                            if (allowUpgrade) {
                                const okPrefix = await renderSvg(prefix, {
                                    seq,
                                    idSuffix: `prefix-${seq}`,
                                    partial: true
                                })
                                if (okPrefix) return
                            }
                        }
                    }

                    // 3) 仍失败：流式中保持静默；流结束后再展示错误
                    if (!effectiveStreaming) {
                        setErrorText('Mermaid 渲染失败：请检查语法是否正确')
                    } else {
                        setErrorText('')
                    }
                } catch (error) {
                    if (renderSeqRef.current !== seq) return
                    if (!effectiveStreaming) {
                        setErrorText(error instanceof Error ? error.message : String(error))
                    } else {
                        setErrorText('')
                    }
                } finally {
                    if (renderSeqRef.current === seq) {
                        setIsRendering(false)
                    }
                }
            })()
        }, delay)

        return () => {
            renderSeqRef.current += 1
            if (timerRef.current != null) {
                window.clearTimeout(timerRef.current)
                timerRef.current = null
            }
        }
    }, [normalizedCode, effectiveStreaming, isDark, renderSvg, safeSvg])

    const containerRef = useRef<HTMLDivElement | null>(null)
    const modalContainerRef = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
        if (!safeSvg) return
        const container = containerRef.current
        const bind = bindFunctionsRef.current
        if (!container || !bind) return
        try {
            bind(container)
        } catch {
            // 忽略绑定事件失败：不影响静态 SVG 展示
        }
    }, [safeSvg])

    useEffect(() => {
        if (!modalOpen) return
        if (!safeSvg) return
        const container = modalContainerRef.current
        const bind = bindFunctionsRef.current
        if (!container || !bind) return
        try {
            bind(container)
        } catch {
            // ignore
        }
    }, [modalOpen, safeSvg])

    // ESC 关闭全屏
    useEffect(() => {
        if (!modalOpen) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setModalOpen(false)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [modalOpen])

    const Toolbar = useMemo(() => {
        const hasSvg = !!(safeSvg || lastGoodSvgRef.current)
        const Btn: React.FC<
            React.PropsWithChildren<{
                title: string
                onClick: () => void
                disabled?: boolean
            }>
        > = ({ title, onClick, disabled, children }) => (
            <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40 disabled:hover:bg-transparent dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
                onClick={onClick}
                disabled={disabled}
                aria-label={title}
                title={title}
            >
                {children}
            </button>
        )

        return (
            <div className="flex items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-2 py-1 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex min-w-0 items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                    <span className="font-medium text-neutral-700 dark:text-neutral-200">Mermaid</span>
                    {effectiveStreaming ? <span>流式生成中</span> : null}
                    {isPartial ? <span>（预览）</span> : null}
                    {isRendering ? <span>渲染中…</span> : null}
                    {!effectiveStreaming && errorText ? (
                        <span className="truncate text-red-600 dark:text-red-400">渲染失败：{errorText}</span>
                    ) : null}
                </div>

                <div className="flex items-center gap-1">
                    <Btn
                        title={showSource ? '查看预览' : '查看源码'}
                        onClick={() => setShowSource((v) => !v)}
                        disabled={collapsed}
                    >
                        {showSource ? <Eye className="h-4 w-4" /> : <Code2 className="h-4 w-4" />}
                    </Btn>

                    <Btn title={copied ? '已复制' : '复制源码'} onClick={onCopy} disabled={!code?.trim()}>
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Btn>

                    <Btn title="导出 SVG" onClick={onExportSvg} disabled={!hasSvg}>
                        <Download className="h-4 w-4" />
                    </Btn>

                    <Btn
                        title={modalOpen ? '退出全屏' : '全屏'}
                        onClick={() => setModalOpen((v) => !v)}
                        disabled={showSource || collapsed}
                    >
                        {modalOpen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </Btn>

                    <div className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-800" />

                    <Btn title="放大" onClick={onZoomIn} disabled={!hasSvg || collapsed || showSource}>
                        <ZoomIn className="h-4 w-4" />
                    </Btn>
                    <Btn title="缩小" onClick={onZoomOut} disabled={!hasSvg || collapsed || showSource}>
                        <ZoomOut className="h-4 w-4" />
                    </Btn>
                    <Btn title="重置缩放/位置" onClick={resetTransform} disabled={!hasSvg || collapsed || showSource}>
                        <RotateCcw className="h-4 w-4" />
                    </Btn>

                    <div className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-800" />

                    <Btn
                        title={collapsed ? '展开' : '折叠'}
                        onClick={() => setCollapsed((v) => !v)}
                    >
                        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                    </Btn>
                </div>
            </div>
        )
    }, [
        code,
        collapsed,
        copied,
        errorText,
        isPartial,
        isRendering,
        modalOpen,
        onCopy,
        onExportSvg,
        onZoomIn,
        onZoomOut,
        resetTransform,
        safeSvg,
        showSource,
        effectiveStreaming
    ])

    const Preview = useMemo(() => {
        const hasSvg = !!(safeSvg || lastGoodSvgRef.current)
        const svgHtml = safeSvg || lastGoodSvgRef.current

        if (!hasSvg) {
            return (
                <div className="p-3 text-sm text-neutral-500 dark:text-neutral-400">
                    {effectiveStreaming
                        ? 'Mermaid 图表生成中…'
                        : errorText
                        ? `渲染失败：${errorText}`
                        : 'Mermaid 图表生成中…'}
                </div>
            )
        }

        return (
            <div
                className="relative overflow-auto bg-white dark:bg-neutral-950"
                style={{ maxHeight: heightStyle }}
            >
                <div
                    className="inline-block origin-top-left"
                    style={{
                        transform: `translate(${translateX}px, ${translateY}px) scale(${zoom})`,
                        cursor: draggingRef.current ? 'grabbing' : 'grab'
                    }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                >
                    <div ref={containerRef} dangerouslySetInnerHTML={{ __html: svgHtml }} />
                </div>
            </div>
        )
    }, [
        effectiveStreaming,
        errorText,
        heightStyle,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        safeSvg,
        translateX,
        translateY,
        zoom
    ])

    const ModalPreview = useMemo(() => {
        const hasSvg = !!(safeSvg || lastGoodSvgRef.current)
        const svgHtml = safeSvg || lastGoodSvgRef.current
        if (!hasSvg) return <div className="p-3 text-sm text-neutral-500 dark:text-neutral-400">暂无可预览内容</div>

        return (
            <div className="relative h-full overflow-auto bg-white dark:bg-neutral-950">
                <div
                    className="inline-block origin-top-left"
                    style={{
                        transform: `translate(${translateX}px, ${translateY}px) scale(${zoom})`,
                        cursor: draggingRef.current ? 'grabbing' : 'grab'
                    }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                >
                    <div ref={modalContainerRef} dangerouslySetInnerHTML={{ __html: svgHtml }} />
                </div>
            </div>
        )
    }, [modalContainerRef, onPointerDown, onPointerMove, onPointerUp, safeSvg, translateX, translateY, zoom])

    const Source = useMemo(() => {
        return (
            <pre
                className="m-0 overflow-auto bg-neutral-950 p-3 text-xs text-neutral-100"
                style={{ maxHeight: heightStyle }}
            >
                {code}
            </pre>
        )
    }, [code, heightStyle])

    return (
        <>
            <div
                data-mermaid-block="true"
                className="not-prose my-3 overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
            >
                {Toolbar}
                {collapsed ? null : showSource ? Source : Preview}
            </div>

            {modalOpen ? (
                <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
                    onClick={() => setModalOpen(false)}
                >
                    <div
                        className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
                            <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                                Mermaid 全屏预览
                            </div>
                            <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
                                onClick={() => setModalOpen(false)}
                                aria-label="关闭"
                                title="关闭"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-hidden">{ModalPreview}</div>
                    </div>
                </div>
            ) : null}
        </>
    )
}

export default MermaidDiagram
