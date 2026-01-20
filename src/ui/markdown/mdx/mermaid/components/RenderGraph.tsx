import { MermaidConfig } from 'mermaid'
import MermaidService from '../mermaidService'
import {
    forwardRef,
    memo,
    useContext,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState
} from 'react'
import GraphContext from '../context'
import { downloadPng, getMermaidId, parseSvgToJsx, svgToPngAndCopy } from '../utils'

const defaultConfig: MermaidConfig = {
    startOnLoad: false,
    flowchart: { useMaxWidth: true, htmlLabels: true },
    suppressErrorRendering: true
}

interface RenderGraphProps {
    code: string
    isComplete?: boolean
    noRest?: boolean
}

export interface RenderGraphRef {
    download: () => Promise<boolean>
    copy: () => Promise<boolean>
    getSvg: () => SVGElement | null
}

// 获取 mermaid 服务实例
const mermaidService = MermaidService.getInstance()

const RenderGraphInner = forwardRef<RenderGraphRef, RenderGraphProps>(({ code, noRest }, ref) => {
    const [svgString, setSvgString] = useState<string>('')
    const [error, setError] = useState<string | null>(null)
    const mermaidConfig = defaultConfig

    const { svgHeight } = useContext(GraphContext)
    const svgIdRef = useRef('')
    const mermaidConfigRef = useRef(mermaidConfig)
    mermaidConfigRef.current = mermaidConfig

    useEffect(() => {
        const initMermaid = async () => {
            try {
                await mermaidService.initialize({
                    startOnLoad: false,
                    ...mermaidConfigRef.current
                } as MermaidConfig)
            } catch (err) {
                const error = err instanceof Error ? err : new Error('Failed to initialize mermaid')
                console.error('Failed to initialize mermaid:', err)
                setError(error.message)
            }
        }

        initMermaid()
    }, [mermaidConfig.theme])

    useEffect(() => {
        if (!code.trim()) {
            setSvgString('')
            return
        }

        setError(null)
        const renderChart = async () => {
            // 生成唯一ID
            const viewID = getMermaidId()
            try {
                await mermaidService.parse(code)
                const { svg } = await mermaidService.render(viewID, code)
                setSvgString(svg)
                svgIdRef.current = `#${viewID}`
            } catch (err) {
                const errorMessage =
                    err instanceof Error ? err.message : 'Failed to render mermaid chart'
                setError(errorMessage)
            }
        }
        renderChart()
    }, [code])

    const svgElement = useMemo(() => {
        if (!svgString) return null
        return parseSvgToJsx(svgString, { noRest })
    }, [svgString, noRest])

    const getExportSize = () => {
        const svg = document.querySelector(svgIdRef.current) as SVGSVGElement | null
        if (!svg) return null

        // 以 mermaid 的 viewBox 尺寸为准（即图的“内容尺寸”），避免受 pan/zoom 视口大小影响
        const baseWidth = svg.viewBox?.baseVal?.width || 0
        const baseHeight = svg.viewBox?.baseVal?.height || 0
        if (baseWidth > 0 && baseHeight > 0) {
            // 画面“糊”通常是因为导出分辨率不够：这里基于 viewBox 计算一个导出倍率，
            // 让最长边至少达到 4K 级别，同时做上限保护，避免 Canvas 过大导致内存/尺寸限制错误。
            const baseMaxSide = Math.max(baseWidth, baseHeight)
            const targetMaxSidePx = 4096
            const minScale = 2
            const maxCanvasSidePx = 8192
            const maxTotalPixels = 25_000_000

            let scale = Math.max(minScale, targetMaxSidePx / baseMaxSide)
            scale = Math.min(scale, maxCanvasSidePx / baseMaxSide)
            const areaScale = Math.sqrt(maxTotalPixels / (baseWidth * baseHeight))
            if (Number.isFinite(areaScale)) {
                scale = Math.min(scale, areaScale)
            }
            if (!Number.isFinite(scale) || scale <= 0) scale = 1
            return {
                width: Math.max(1, Math.round(baseWidth * scale)),
                height: Math.max(1, Math.round(baseHeight * scale))
            }
        }

        const rect = svg.getBoundingClientRect()
        return {
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height))
        }
    }

    useImperativeHandle(ref, () => ({
        download: async () => {
            const size = getExportSize()
            if (!size) return false
            return downloadPng({
                id: svgIdRef.current,
                ...size
            })
        },
        copy: async () => {
            const size = getExportSize()
            if (!size) return false
            return svgToPngAndCopy({
                id: svgIdRef.current,
                ...size
            })
        },
        getSvg: () => {
            return document.querySelector(svgIdRef.current) as SVGElement | null
        }
    }))
    return (
        <div className={`react-markdown-mermaid`}>
            <div
                className="react-markdown-mermaid__instance"
                style={{
                    height: svgHeight
                }}
            >
                {svgElement}
            </div>
        </div>
    )
})

const RenderGraph = memo(RenderGraphInner)

export default RenderGraph
