import { Button, Divider, Tooltip } from '@douyinfe/semi-ui'
import { Download, FoldVertical, ScanEye, UnfoldVertical, ZoomIn, ZoomOut } from 'lucide-react'
import type { IMarkmapJSONOptions } from 'markmap-view'
import type { RenderMarkmapRef } from '../types'
import FullscreenButton from './FullscreenButton'

const ICON_BUTTON_CLASS_NAME = 'h-[28px] w-[28px] rounded-full p-[6px]'

interface IconActionButtonProps {
    icon: React.ReactNode
    tooltip: string
    onClick: () => void
}

function IconActionButton({ icon, tooltip, onClick }: IconActionButtonProps) {
    return (
        <Tooltip content={tooltip}>
            <Button
                onClick={onClick}
                className={ICON_BUTTON_CLASS_NAME}
                type="tertiary"
                theme="borderless"
            >
                {icon}
            </Button>
        </Tooltip>
    )
}

interface MarkmapActionsProps {
    code: string
    graphRef: React.RefObject<RenderMarkmapRef>
    jsonOptions?: Partial<IMarkmapJSONOptions>
    isFullscreen?: boolean
}

const MarkmapActions: React.FC<MarkmapActionsProps> = ({
    code,
    graphRef,
    jsonOptions,
    isFullscreen
}) => {
    const run = (action: (graph: RenderMarkmapRef) => Promise<unknown>) => {
        if (!graphRef.current) return
        void action(graphRef.current)
    }

    const handleDownload = async () => {
        if (!graphRef.current) return

        try {
            await graphRef.current.downloadPng()
        } catch (error) {
            console.error('Download failed:', error)
        }
    }

    return (
        <>
            <IconActionButton
                icon={<ZoomIn size={16} />}
                tooltip="放大"
                onClick={() => run((graph) => graph.zoomIn())}
            />
            <IconActionButton
                icon={<ZoomOut size={16} />}
                tooltip="缩小"
                onClick={() => run((graph) => graph.zoomOut())}
            />
            <IconActionButton
                icon={<ScanEye size={16} />}
                tooltip="自适应"
                onClick={() => run((graph) => graph.fit())}
            />
            <IconActionButton
                icon={<FoldVertical size={16} />}
                tooltip="收起到二级"
                onClick={() => run((graph) => graph.collapseToLevel(2))}
            />
            <IconActionButton
                icon={<UnfoldVertical size={16} />}
                tooltip="全部展开"
                onClick={() => run((graph) => graph.expandAll())}
            />
            {!isFullscreen && <FullscreenButton code={code} jsonOptions={jsonOptions} />}
            <Divider layout="vertical" className="mx-[12px]" />
            <Button
                onClick={() => void handleDownload()}
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

export default MarkmapActions
