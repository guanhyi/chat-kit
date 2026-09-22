import React, { useState } from 'react'
import { TimelineItem } from './TimelineItem'
import { ReasoningContainer } from './ReasoningContainer'
import { ChevronDown, ChevronUp, Wrench } from 'lucide-react'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'

export interface ToolBlockProps {
    toolName: string
    content: string
    status?: 'streaming' | 'success' | 'idle'
    className?: string
}

/**
 * 工具调用块：展示工具调用过程与结果
 */
export const ToolBlock: React.FC<ToolBlockProps> = ({
    toolName,
    content,
    status = 'idle',
    className
}) => {
    const [open, setOpen] = useState(false)

    return (
        <ReasoningContainer className={className}>
            <TimelineItem
                icon={<Wrench size={11} />}
                highlight={status === 'streaming'}
                title={
                    <div
                        className="flex items-center text-[13px] hover:bg-gray-100 rounded-md cursor-pointer flex-1 w-full"
                        onClick={() => setOpen((v) => !v)}
                    >
                        <div className="font-[500]">
                            {status === 'streaming'
                                ? `正在调用 ${toolName}`
                                : `已调用 ${toolName}`}
                        </div>
                        <div className="text-gray-400 ml-auto rounded-md p-[4px]">
                            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </div>
                    </div>
                }
                description={
                    open ? (
                        <div className="mt-1.5 w-full overflow-hidden">
                            <div className="bg-gray-50 rounded-md border border-gray-100 p-2 w-full">
                                <div className="overflow-x-auto w-full max-h-60 overflow-y-auto">
                                    <MarkdownRenderer
                                        className="prose prose-sm min-w-0 text-[12px] [&_table]:whitespace-nowrap [&_p]:mb-2 [&_ul]:mb-2 [&_ol]:mb-2 [&_pre]:whitespace-pre [&_pre]:overflow-x-auto [&_code]:whitespace-pre"
                                        content={content || ''}
                                        status={status}
                                    />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div />
                    )
                }
            />
        </ReasoningContainer>
    )
}

export default ToolBlock
