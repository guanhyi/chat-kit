import { Modal, Button } from '@douyinfe/semi-ui'
import { create, useModal } from '@ebay/nice-modal-react'
import { PanZoomState } from '../panZoomState'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import RenderGraph, { RenderGraphRef } from './RenderGraph'
import { GraphProvider } from '../context'
import MermaidBlockActions from './actions'
interface FullscreenProps {
    code: string
    onClose?: () => void
}
export const FullscreenModal = create(({ code }: FullscreenProps) => {
    const modal = useModal()
    const [height, setHeight] = useState(0)
    const renderGraphRef = useRef<RenderGraphRef>(null)
    const contentRef = useRef<HTMLDivElement>(null!)
    const panZoomState = useMemo(() => {
        return new PanZoomState({
            autoZoomOut: false, // 禁用自动缩放，保持原始大小
            mouseWheelZoomEnabled: true
        })
    }, [])
    const listenResize = useCallback(() => {
        setHeight(contentRef.current.clientHeight)
    }, [])

    useLayoutEffect(() => {
        listenResize()
        window.addEventListener('resize', listenResize)
        return () => {
            window.removeEventListener('resize', listenResize)
        }
    }, [])

    return (
        <Modal visible={modal.visible} fullScreen>
            <GraphProvider isComplete={true} panZoomState={panZoomState} svgHeight={height}>
                <div className="ds-markdown mermaid-fullscreen">
                    <div className="mermaid-fullscreen__header">
                        <div className="mermaid-fullscreen__header-center"></div>
                        <div className="mermaid-fullscreen__header-right">
                            <MermaidBlockActions
                                graphRef={renderGraphRef}
                                code={code}
                                isFullscreen={true}
                            />
                        </div>
                    </div>
                    <div className="mermaid-fullscreen__content" ref={contentRef}>
                        <RenderGraph code={code} isComplete={true} ref={renderGraphRef} />
                    </div>
                </div>
            </GraphProvider>
        </Modal>
    )
})
