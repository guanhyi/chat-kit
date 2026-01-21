import React, { useState } from 'react'
import { TimelineItem } from './TimelineItem'
import { ReasoningContainer } from './ReasoningContainer'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'

export interface ThinkingBlockProps {
    content: string
    status?: 'streaming' | 'success' | 'idle'
    className?: string
}

/**
 * 思考过程块：用于展示 <think> 内容
 */
export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
    content,
    status = 'idle',
    className
}) => {
    const [open, setOpen] = useState(status === 'streaming')
    return (
        <ReasoningContainer className={className}>
            <TimelineItem
                highlight={status === 'streaming'}
                title={
                    <div
                        className="flex items-center text-[14px] hover:bg-gray-200 rounded-lg cursor-pointer flex-1 w-full"
                        onClick={() => setOpen((v) => !v)}
                    >
                        <div className="font-[500] pl-[10px]">
                            {status === 'streaming' ? '思考中' : '已深度思考'}
                        </div>
                        <div className="text-gray-400 ml-auto rounded-lg p-[5px]">
                            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </div>
                    </div>
                }
                description={
                    open ? (
                        <div className="ml-[10px] mt-2 prose prose-sm max-w-full pr-2">
                            <MarkdownRenderer content={content || ''} status={status} />
                        </div>
                    ) : (
                        <div />
                    )
                }
            />
        </ReasoningContainer>
    )
}

export default ThinkingBlock

