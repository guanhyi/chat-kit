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
import NiceModal from '@ebay/nice-modal-react'
import { CodeHighlight } from '@douyinfe/semi-ui'
import 'prismjs/components/prism-mermaid.js'
const MermaidBlock: React.FC<MermaidProps> = (props) => {
    const [isFullscreen, setIsFullscreen] = useState(false)
    const {
        code,
        isComplete = false,
        strictFlowchart,
        downloadFileName,
        downloadTitle,
        nodeIds,
        onNodeClick,
        onRenderError
    } = props
    const [activeSegmented, setActiveSegmented] = useState<SegmentedType>('mermaid')
    const renderGraphRef = useRef<RenderGraphRef>(null)
    const panZoomState = useMemo(() => {
        return new PanZoomState({
            autoZoomOut: false, // 禁用自动缩放，保持原始大小
            mouseWheelZoomEnabled: true
        })
    }, [])
    return (
        <GraphProvider isComplete={isComplete} panZoomState={panZoomState} svgHeight={500}>
            <NiceModal.Provider>
                <div className="not-prose my-3 overflow-hidden rounded-lg border border-neutral-200 bg-white">
                    <div className="bg-gray-100 px-[6px] py-[6px] flex">
                        <Segmented value={activeSegmented} onChange={setActiveSegmented} />
                        {activeSegmented === 'mermaid' && (
                            <div className="ml-auto flex items-center">
                                <MermaidBlockActions code={code} graphRef={renderGraphRef} />
                            </div>
                        )}
                    </div>
                    <div className="m-0 overflow-auto bg-gray-50 p-3 text-xs ">
                        <div style={{ display: activeSegmented === 'mermaid' ? 'block' : 'none' }}>
                            <RenderGraph
                                code={code}
                                isComplete={isComplete}
                                strictFlowchart={strictFlowchart}
                                downloadFileName={downloadFileName}
                                downloadTitle={downloadTitle}
                                nodeIds={nodeIds}
                                onNodeClick={onNodeClick}
                                onRenderError={onRenderError}
                                ref={renderGraphRef}
                            />
                        </div>
                        <div style={{ display: activeSegmented === 'code' ? 'block' : 'none' }}>
                            <CodeHighlight
                                style={{
                                    //@ts-ignore
                                    '--semi-color-tertiary-light-default':
                                        'rgb(249 250 251 / var(--tw-bg-opacity, 1))'
                                }}
                                language="mermaid"
                                code={code}
                            />
                        </div>
                    </div>
                </div>
            </NiceModal.Provider>
        </GraphProvider>
    )
}

export default MermaidBlock
