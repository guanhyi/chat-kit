import React, { useState } from 'react'
import { TimelineItem } from './TimelineItem'
import { ReasoningContainer } from './ReasoningContainer'
import { Brain, ChevronDown, ChevronUp } from 'lucide-react'
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
    const [open, setOpen] = useState(false)
    return (
        <ReasoningContainer className={className}>
            <TimelineItem
                icon={<Brain size={11} />}
                highlight={status === 'streaming'}
                title={
                    <div
                        className="flex items-center text-[13px] hover:bg-gray-100 rounded-md cursor-pointer flex-1 w-full"
                        onClick={() => setOpen((v) => !v)}
                    >
                        <div className="font-[500]">
                            {status === 'streaming' ? '思考中' : '已深度思考'}
                        </div>
                        <div className="text-gray-400 ml-auto rounded-md p-[4px]">
                            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </div>
                    </div>
                }
                description={
                    open ? (
                        <div className="ml-[8px] mt-1.5 prose prose-sm max-w-full pr-2 text-[12px]">
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
