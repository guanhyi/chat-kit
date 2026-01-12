import { MermaidConfig } from 'mermaid'
import MermaidService from '../mermaidService'
import {
    forwardRef,
    memo,
    useContext,
    useEffect,
    useImperativeHandle,
    useRef,
    useState
} from 'react'
import GraphContext from '../context'
import { downloadPng, getMermaidId, parseSvgToJsx, svgToPngAndCopy } from '../utils'

const defaultConfig: MermaidConfig = {
    startOnLoad: false,
    flowchart: { useMaxWidth: true, htmlLabels: true }
}

interface RenderGraphProps {
    code: string
    isComplete?: boolean
}

export interface RenderGraphRef {
    download: () => Promise<boolean>
    copy: () => Promise<boolean>
    getSvg: () => SVGElement | null
}

// 获取 mermaid 服务实例
const mermaidService = MermaidService.getInstance()

const RenderGraphInner = forwardRef<RenderGraphRef, RenderGraphProps>(({ code }, ref) => {
    const [svgElement, setSvgElement] = useState<React.ReactElement | null>(null)
    const [error, setError] = useState<string | null>(null)
    const mermaidConfig = defaultConfig

    const { svgHeight, panZoomState } = useContext(GraphContext)
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
            setSvgElement(null)
            return
        }

        setError(null)
        const renderChart = async () => {
            // 生成唯一ID
            const viewID = getMermaidId()
            try {
                await mermaidService.parse(code)
                const { svg } = await mermaidService.render(viewID, code)
                const svgElement = parseSvgToJsx(svg)
                if (!svgElement) {
                    return
                }
                setSvgElement(svgElement)
                svgIdRef.current = `#${viewID}`
            } catch (err) {
                const errorMessage =
                    err instanceof Error ? err.message : 'Failed to render mermaid chart'
                setError(errorMessage)
            }
        }
        renderChart()
    }, [code])

    useImperativeHandle(ref, () => ({
        download: async () => {
            const sizes = panZoomState.getSizes()
            return downloadPng({
                id: svgIdRef.current,
                width: sizes?.width || 0,
                height: sizes?.height || 0
            })
        },
        copy: async () => {
            const sizes = panZoomState.getSizes()
            return svgToPngAndCopy({
                id: svgIdRef.current,
                width: sizes?.width || 0,
                height: sizes?.height || 0
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
