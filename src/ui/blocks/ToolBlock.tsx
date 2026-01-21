import React, { useState } from 'react'
import { TimelineItem } from './TimelineItem'
import { ReasoningContainer } from './ReasoningContainer'
import { ChevronDown, ChevronUp } from 'lucide-react'
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
    const [open, setOpen] = useState(true)
    void toolName

    return (
        <ReasoningContainer className={className}>
            <TimelineItem
                highlight={status === 'streaming'}
                title={
                    <div
                        className="flex items-center text-[14px] hover:bg-gray-200 rounded-lg cursor-pointer flex-1 w-full"
                        onClick={() => setOpen((v) => !v)}
                    >
                        <div className="font-[500] pl-[10px]">已完成工具调用</div>
                        <div className="text-gray-400 ml-auto rounded-lg p-[5px]">
                            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </div>
                    </div>
                }
                description={
                    open ? (
                        <div className="mt-2 w-full overflow-hidden">
                            <div className="bg-gray-50 rounded-lg border p-2 w-full">
                                <div className="overflow-x-auto w-full max-h-60 overflow-y-auto">
                                    <MarkdownRenderer
                                        className="prose prose-sm min-w-0 [&_table]:whitespace-nowrap [&_p]:mb-2 [&_ul]:mb-2 [&_ol]:mb-2 [&_pre]:whitespace-pre [&_pre]:overflow-x-auto [&_code]:whitespace-pre"
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

