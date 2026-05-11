import { create, useModal } from '@ebay/nice-modal-react'
import { Modal } from '@douyinfe/semi-ui'
import type { IMarkmapJSONOptions } from 'markmap-view'
import { useRef } from 'react'
import styled from 'styled-components'
import RenderMarkmap from '../RenderMarkmap'
import type { RenderMarkmapRef } from '../types'
import MarkmapActions from './MarkmapActions'

interface FullscreenProps {
    code: string
    jsonOptions?: Partial<IMarkmapJSONOptions>
}

const FullscreenModalStyled = styled(Modal)`
    .semi-modal-body-wrapper {
        flex: 1;
    }
`

function Content({ code, jsonOptions }: FullscreenProps) {
    const graphRef = useRef<RenderMarkmapRef>(null)

    return (
        <div className="flex h-full flex-col">
            <div className="flex border-b border-neutral-200 bg-white px-[6px] py-[6px]">
                <div className="ml-auto flex items-center">
                    <MarkmapActions
                        code={code}
                        graphRef={graphRef}
                        jsonOptions={jsonOptions}
                        isFullscreen={true}
                    />
                </div>
            </div>
            <div className="flex-1 min-h-0 bg-white text-xs">
                <RenderMarkmap
                    code={code}
                    isComplete={true}
                    jsonOptions={jsonOptions}
                    width="100%"
                    height="100%"
                    frameless={true}
                    ref={graphRef}
                />
            </div>
        </div>
    )
}

export const FullscreenModal = create(({ code, jsonOptions }: FullscreenProps) => {
    const modal = useModal()

    return (
        //@ts-ignore
        <FullscreenModalStyled
            visible={modal.visible}
            fullScreen
            footer={null}
            onCancel={() => {
                modal.hide()
                setTimeout(() => {
                    modal.remove()
                }, 300)
            }}
            className="flex-1"
            bodyStyle={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%'
            }}
        >
            <Content code={code} jsonOptions={jsonOptions} />
        </FullscreenModalStyled>
    )
})
