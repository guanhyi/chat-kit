import { Modal, Button } from '@douyinfe/semi-ui'
import { create, useModal } from '@ebay/nice-modal-react'
import { PanZoomState } from '../panZoomState'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import RenderGraph, { RenderGraphRef } from './RenderGraph'
import { GraphProvider } from '../context'
import MermaidBlockActions from './actions'
import styled from 'styled-components'
interface FullscreenProps {
    code: string
    onClose?: () => void
}

const Content = ({ code }: { code: string }) => {
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
        console.log(contentRef.current.clientHeight)

        setHeight(contentRef.current.clientHeight)
    }, [])

    useLayoutEffect(() => {
        listenResize()
    }, [])

    return (
        <GraphProvider isComplete={true} panZoomState={panZoomState} svgHeight={height}>
            <div className="flex flex-col h-full">
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
                <div className="flex-1" ref={contentRef}>
                    <RenderGraph noRest code={code} isComplete={true} ref={renderGraphRef} />
                </div>
            </div>
        </GraphProvider>
    )
}

const ModalStyled = styled(Modal)`
    .semi-modal-body-wrapper {
        flex: 1;
    }
`

export const FullscreenModal = create(({ code }: FullscreenProps) => {
    const modal = useModal()

    return (
        <ModalStyled
            visible={modal.visible}
            fullScreen
            footer={null}
            onCancel={() => {
                modal.hide()
                setTimeout(() => {
                    modal.remove()
                }, 300)
            }}
            className={'flex-1'}
            bodyStyle={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%'
            }}
        >
            <Content code={code} />
        </ModalStyled>
    )
})
