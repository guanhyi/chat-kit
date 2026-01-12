import { useContext } from 'react'
import GraphContext from '../../context'
import { RenderGraphRef } from '../RenderGraph'
import { Button, Tooltip, Divider } from '@douyinfe/semi-ui'
import { Download, ScanEye, ZoomIn, ZoomOut } from 'lucide-react'

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
                    className="rounded-full"
                    type="tertiary"
                    theme="borderless"
                >
                    <ZoomIn />
                </Button>
            </Tooltip>
            <Tooltip content="缩小">
                <Button
                    onClick={zoomOut}
                    className="rounded-full"
                    type="tertiary"
                    theme="borderless"
                >
                    <ZoomOut />
                </Button>
            </Tooltip>
            <Tooltip content="自适应">
                <Button onClick={fit} className="rounded-full" type="tertiary" theme="borderless">
                    <ScanEye />
                </Button>
            </Tooltip>
            <Divider layout="vertical" className="mx-[12px]" />
            <Button
                onClick={handleDownload}
                className="rounded-lg"
                type="tertiary"
                theme="borderless"
            >
                <Download />
                下载
            </Button>
        </>
    )
}

export default MermaidBlockActions
