import React, { useEffect, useMemo, useRef, useState } from 'react'
import MermaidService from './mermaidService'
import { MermaidProps } from './types'
import { MermaidConfig } from 'mermaid'
import { getMermaidId, parseSvgToJsx } from './utils'
import { PanZoomState } from './panZoomState'
import { GraphProvider } from './context'
import RenderGraph, { RenderGraphRef } from './components/RenderGraph'
import { Segmented, SegmentedType } from './components/Segmented'
import MermaidBlockActions from './components/actions'

// 获取 mermaid 服务实例
const mermaidService = MermaidService.getInstance()

const MermaidBlock: React.FC<MermaidProps> = (props) => {
    const [isFullscreen, setIsFullscreen] = useState(false)
    const { code, isComplete = false } = props
    const [activeSegmented, setActiveSegmented] = useState<SegmentedType>('mermaid')
    const renderGraphRef = useRef<RenderGraphRef>(null)
    const panZoomState = useMemo(() => {
        return new PanZoomState({
            autoZoomOut: false // 禁用自动缩放，保持原始大小
        })
    }, [])
    return (
        <GraphProvider isComplete={isComplete} panZoomState={panZoomState} svgHeight={380}>
            <div className="not-prose my-3 overflow-hidden rounded-lg border border-neutral-200 bg-white">
                <div className="bg-gray-100 px-[6px] py-[6px] flex">
                    <Segmented value={activeSegmented} onChange={setActiveSegmented} />
                    <div className="ml-auto flex">
                        <MermaidBlockActions code={code} graphRef={renderGraphRef} />
                    </div>
                </div>
                <div className="m-0 overflow-auto bg-gray-50 p-3 text-xs text-neutral-100">
                    <RenderGraph code={code} isComplete={isComplete} ref={renderGraphRef} />
                </div>
            </div>
        </GraphProvider>
    )
}

export default MermaidBlock
