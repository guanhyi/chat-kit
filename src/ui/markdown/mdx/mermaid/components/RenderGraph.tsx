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
    useState,
    type MouseEvent as ReactMouseEvent
} from 'react'
import GraphContext from '../context'
import { downloadPng, getMermaidId, parseSvgToJsx, svgToPngAndCopy } from '../utils'
import { resolveMermaidNodeId, validateSafeFlowchart } from '../security'

const defaultConfig: MermaidConfig = {
    startOnLoad: false,
    securityLevel: 'strict',
    flowchart: { useMaxWidth: true, htmlLabels: false },
    suppressErrorRendering: true
}

interface RenderGraphProps {
    code: string
    isComplete?: boolean
    noRest?: boolean
    strictFlowchart?: boolean
    downloadFileName?: string
    downloadTitle?: string
    nodeIds?: readonly string[]
    onNodeClick?: (nodeId: string) => void
    onRenderError?: (message: string) => void
}

export interface RenderGraphRef {
    download: () => Promise<boolean>
    copy: () => Promise<boolean>
    getSvg: () => SVGElement | null
}

// 获取 mermaid 服务实例
const mermaidService = MermaidService.getInstance()

const RenderGraphInner = forwardRef<RenderGraphRef, RenderGraphProps>(({
    code,
    noRest,
    strictFlowchart,
    downloadFileName,
    downloadTitle,
    nodeIds = [],
    onNodeClick,
    onRenderError
}, ref) => {
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
                const safeCode = strictFlowchart ? validateSafeFlowchart(code) : code
                await mermaidService.parse(safeCode)
                const { svg } = await mermaidService.render(viewID, safeCode)
                setSvgString(svg)
                svgIdRef.current = `#${viewID}`
            } catch (err) {
                const errorMessage =
                    err instanceof Error ? err.message : 'Failed to render mermaid chart'
                setError(errorMessage)
                onRenderError?.(errorMessage)
            }
        }
        renderChart()
    }, [code])

    const svgElement = useMemo(() => {
        if (!svgString) return null
        return parseSvgToJsx(svgString, { noRest })
    }, [svgString, noRest])

    useImperativeHandle(ref, () => ({
        download: async () => {
            return downloadPng({
                id: svgIdRef.current,
                fileName: downloadFileName,
                title: downloadTitle
            })
        },
        copy: async () => {
            return svgToPngAndCopy({
                id: svgIdRef.current
            })
        },
        getSvg: () => {
            return document.querySelector(svgIdRef.current) as SVGElement | null
        }
    }))
    const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
        if (!onNodeClick || nodeIds.length === 0) return
        const target = event.target instanceof Element ? event.target.closest<SVGGElement>('g.node') : null
        const nodeId = target?.id ? resolveMermaidNodeId(target.id, nodeIds) : undefined
        if (nodeId) onNodeClick(nodeId)
    }

    if (error) {
        return <div className="rounded bg-amber-50 p-3 text-xs text-amber-700">脑图暂时无法渲染，请查看层级大纲。</div>
    }

    return (
        <div className={`react-markdown-mermaid`}>
            <div
                className="react-markdown-mermaid__instance"
                onClick={handleClick}
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
