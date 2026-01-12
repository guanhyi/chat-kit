import { RenderGraphRef } from '../RenderGraph'

interface MermaidBlockActionsProps {
    graphRef: React.RefObject<RenderGraphRef>
    code: string
    onExitFullscreen?: () => void
    isFullscreen?: boolean
}

const MermaidBlockActions: React.FC<MermaidBlockActionsProps> = () => {
    return <div></div>
}
