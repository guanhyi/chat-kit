import { CSSProperties, useRef, useState } from 'react'
import NiceModal from '@ebay/nice-modal-react'
import { CodeHighlight } from '@douyinfe/semi-ui'
import RenderMarkmap from './RenderMarkmap'
import type { MarkmapBlockProps, MarkmapViewMode, RenderMarkmapRef } from './types'
import MarkmapActions from './components/MarkmapActions'
import MarkmapSegmented from './components/Segmented'
import 'prismjs/components/prism-markdown.js'

const CODE_PANEL_STYLE: CSSProperties = {
    // @ts-expect-error semi 允许通过 CSS 变量覆写背景色
    '--semi-color-tertiary-light-default': 'rgb(249 250 251 / var(--tw-bg-opacity, 1))'
}

const MarkmapBlock: React.FC<MarkmapBlockProps> = ({ code, isComplete = false, jsonOptions }) => {
    const [activeMode, setActiveMode] = useState<MarkmapViewMode>('chart')
    const graphRef = useRef<RenderMarkmapRef>(null)

    return (
        <NiceModal.Provider>
            <div className="not-prose my-3 overflow-hidden rounded-lg border border-neutral-200 bg-white">
                <div className="flex items-center gap-2 bg-gray-100 px-[6px] py-[6px]">
                    <MarkmapSegmented value={activeMode} onChange={setActiveMode} />
                    {activeMode === 'chart' && (
                        <div className="ml-auto flex items-center">
                            <MarkmapActions
                                code={code}
                                graphRef={graphRef}
                                jsonOptions={jsonOptions}
                            />
                        </div>
                    )}
                </div>
                {activeMode === 'chart' ? (
                    <div className="m-0 overflow-hidden bg-gray-50 p-2 text-xs">
                        <RenderMarkmap
                            code={code}
                            isComplete={isComplete}
                            jsonOptions={jsonOptions}
                            frameless={true}
                            ref={graphRef}
                        />
                    </div>
                ) : (
                    <div className="m-0 overflow-auto bg-gray-50 p-3 text-xs">
                        <CodeHighlight code={code} language="markdown" style={CODE_PANEL_STYLE} />
                    </div>
                )}
            </div>
        </NiceModal.Provider>
    )
}

export default MarkmapBlock
