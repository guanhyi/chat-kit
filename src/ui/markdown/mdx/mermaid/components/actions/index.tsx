import { useContext } from 'react'
import GraphContext from '../../context'
import { RenderGraphRef } from '../RenderGraph'
import { Button, Tooltip, Divider } from '@douyinfe/semi-ui'
import { Download, ScanEye, ZoomIn, ZoomOut } from 'lucide-react'
import { FullscreenButton } from './FullscreenButton'

interface MermaidBlockActionsProps {
    graphRef: React.RefObject<RenderGraphRef>
    code: string
    onExitFullscreen?: () => void
    isFullscreen?: boolean
}

const MermaidBlockActions: React.FC<MermaidBlockActionsProps> = ({
    code,
    graphRef,
    onExitFullscreen,
    isFullscreen
}) => {
    const { panZoomState, isComplete } = useContext(GraphContext)

    const zoomIn = () => {
        panZoomState.zoomIn()
    }

    const zoomOut = () => {
        panZoomState.zoomOut()
    }

    const fit = () => {
        panZoomState.fit()
    }

    // 下载图片处理函数
    const handleDownload = async () => {
        if (graphRef.current) {
            try {
                await graphRef.current.download()
            } catch (error) {
                console.error('Download failed:', error)
            }
        }
    }

    return (
        <>
            <Tooltip content="放大">
                <Button
                    onClick={zoomIn}
                    className="rounded-full p-[6px] h-[28px] w-[28px]"
                    type="tertiary"
                    theme="borderless"
                >
                    <ZoomIn size={16} />
                </Button>
            </Tooltip>
            <Tooltip content="缩小">
                <Button
                    onClick={zoomOut}
                    className="rounded-full p-[6px] h-[28px] w-[28px]"
                    type="tertiary"
                    theme="borderless"
                >
                    <ZoomOut size={16} />
                </Button>
            </Tooltip>
            <Tooltip content="自适应">
                <Button
                    onClick={fit}
                    className="rounded-full p-[6px] h-[28px] w-[28px]"
                    type="tertiary"
                    theme="borderless"
                >
                    <ScanEye size={16} />
                </Button>
            </Tooltip>
            {!isFullscreen && <FullscreenButton code={code} />}
            <Divider layout="vertical" className="mx-[12px]" />
            <Button
                onClick={handleDownload}
                className="rounded-lg"
                type="tertiary"
                theme="borderless"
            >
                <Download size={16} />
                下载 PNG
            </Button>
        </>
    )
}

export default MermaidBlockActions
