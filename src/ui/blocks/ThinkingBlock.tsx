import React, { useEffect, useRef, useState } from 'react'
import { TimelineItem } from './TimelineItem'
import { ReasoningContainer } from './ReasoningContainer'
import { Brain, ChevronDown, ChevronUp } from 'lucide-react'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { CollapsibleBlockBody } from './CollapsibleBlockBody'

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
    const streaming = status === 'streaming'
    const [open, setOpen] = useState(streaming)
    const userToggledRef = useRef(false)

    useEffect(() => {
        if (streaming) {
            setOpen(true)
            return
        }
        if (!userToggledRef.current) setOpen(false)
    }, [streaming])
    return (
        <ReasoningContainer className={className}>
            <TimelineItem
                icon={<Brain size={11} />}
                highlight={status === 'streaming'}
                title={
                    <div
                        className="flex items-center text-[13px] hover:bg-gray-100 rounded-md cursor-pointer flex-1 w-full"
                        onClick={() => {
                            userToggledRef.current = true
                            setOpen((v) => !v)
                        }}
                    >
                        <div className="font-[500] pl-[8px]">
                            {status === 'streaming' ? '思考中' : '已深度思考'}
                        </div>
                        <div className="text-gray-400 ml-auto rounded-md p-[4px]">
                            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </div>
                    </div>
                }
                description={
                    <CollapsibleBlockBody open={open} streaming={streaming}>
                        <div className="ml-[8px] mt-1.5 prose prose-sm max-w-full pr-2 text-[12px]">
                            <MarkdownRenderer content={content || ''} status={status} />
                        </div>
                    </CollapsibleBlockBody>
                }
            />
        </ReasoningContainer>
    )
}

export default ThinkingBlock
