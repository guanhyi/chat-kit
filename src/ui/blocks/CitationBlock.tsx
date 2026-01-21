import React from 'react'
import { TimelineItem } from './TimelineItem'
import { ReasoningContainer } from './ReasoningContainer'

export interface CitationItem {
    id: string
    title: string
    url?: string
    extra?: any
}

export interface CitationBlockProps {
    docs: CitationItem[]
    className?: string
}

/**
 * 引用文档块：展示参考文档列表
 */
export const CitationBlock: React.FC<CitationBlockProps> = ({ docs, className }) => {
    if (!docs || docs.length === 0) return null
    return (
        <ReasoningContainer className={className}>
            <TimelineItem
                title={<div className="pl-[10px]">参考文档</div>}
                description={
                    <div className="ml-[10px] mt-2">
                        <ul className="list-disc pl-5">
                            {docs.map((d) => (
                                <li key={d.id} className="leading-6">
                                    {d.url ? (
                                        <a
                                            href={d.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-[#2563eb]"
                                        >
                                            {d.title}
                                        </a>
                                    ) : (
                                        <span>{d.title}</span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                }
            />
        </ReasoningContainer>
    )
}

export default CitationBlock

