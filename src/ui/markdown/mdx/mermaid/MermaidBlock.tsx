import React, { useEffect, useMemo, useRef, useState } from 'react'
import MermaidService from './mermaidService'
import { MermaidProps } from './types'
import { MermaidConfig } from 'mermaid'
import { getMermaidId, parseSvgToJsx } from './utils'
import { PanZoomState } from './panZoomState'
import { GraphProvider } from './context'
import RenderGraph, { RenderGraphRef } from './components/RenderGraph'

// 获取 mermaid 服务实例
const mermaidService = MermaidService.getInstance()

const MermaidBlock: React.FC<MermaidProps> = (props) => {
    const [isFullscreen, setIsFullscreen] = useState(false)
    const { code, isComplete = false } = props
    const [activeSegmented, setActiveSegmented] = useState('mermaid')
    const renderGraphRef = useRef<RenderGraphRef>(null)
    const panZoomState = useMemo(() => {
        return new PanZoomState({
            autoZoomOut: false // 禁用自动缩放，保持原始大小
        })
    }, [])
    return (
        <GraphProvider isComplete={isComplete} panZoomState={panZoomState} svgHeight={380}>
            <div>
                <RenderGraph code={code} isComplete={isComplete} ref={renderGraphRef} />
            </div>
        </GraphProvider>
    )
}

export default MermaidBlock
