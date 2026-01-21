import React from 'react'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { TimelineItem } from './TimelineItem'
import { ReasoningContainer } from './ReasoningContainer'
import { MarkdownAnimateProps } from '../markdown/animate/AnimatedMarkdown'

export interface MainTextBlockProps {
    content: string
    status?: 'streaming' | 'success' | 'idle'
    citations?: any[]
    className?: string
}

/**
 * 正文块：使用 MarkdownRenderer 渲染主回答内容
 */
export const MainTextBlock: React.FC<MainTextBlockProps & MarkdownAnimateProps> = ({
    content,
    status = 'idle',
    citations,
    className
}) => {
    return (
        <MarkdownRenderer
            className={className || 'prose w-full max-w-full markdown markdown-here-wrapper'}
            content={content || ''}
            status={status}
            citations={citations}
        />
    )
}

export default MainTextBlock
