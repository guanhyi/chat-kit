import React from 'react'
import { Popover, Typography } from '@douyinfe/semi-ui'
import { MarkdownRenderer, MarkdownRendererProps } from '../markdown/MarkdownRenderer'
import { TimelineItem } from './TimelineItem'
import { ReasoningContainer } from './ReasoningContainer'
import { MarkdownAnimateProps } from '../markdown/animate/AnimatedMarkdown'

export interface MainTextBlockProps {
    content: string
    status?: 'streaming' | 'success' | 'idle'
    citations?: any[]
    className?: string
    citationRender?: MarkdownRendererProps['citationRender']
}

const DEFAULT_CITATION_DETAIL_MAX_WIDTH = 280
const EMPTY_CITATION_DETAIL = '暂无详情'
const DEFAULT_CITATION_INLINE_MARGIN = '0.25em'

type CitationRender = NonNullable<MarkdownRendererProps['citationRender']>
type CitationRenderProps = Parameters<CitationRender>[0]
type CitationDetail = {
    title?: string
    url?: string
    extra?: string
}

const defaultCitationTextStyle: React.CSSProperties = {
    lineHeight: 'inherit',
    marginInline: DEFAULT_CITATION_INLINE_MARGIN,
    paddingInline: '0.35em',
    borderRadius: '0.5em',
    backgroundColor: 'var(--semi-color-fill-0)',
    fontSize: '0.875em',
    whiteSpace: 'nowrap',
    cursor: 'pointer'
}

const parseCitationDetail = (
    citationDetail?: CitationRenderProps['citationDetail']
): CitationDetail | undefined => {
    if (!citationDetail) {
        return undefined
    }

    return typeof citationDetail === 'string'
        ? (JSON.parse(citationDetail) as CitationDetail)
        : (citationDetail as CitationDetail)
}

const getCitationExtraText = (citationDetail?: CitationDetail) => {
    return citationDetail?.extra
}

export const defaultCitationRender: CitationRender = ({ id, citationDetail }) => {
    const jsonDetail = parseCitationDetail(citationDetail)

    const extraText = getCitationExtraText(jsonDetail)
    // console.log(citationDetail)

    return (
        <Popover
            showArrow
            position="top"
            content={
                <div
                    style={{
                        maxWidth: DEFAULT_CITATION_DETAIL_MAX_WIDTH,
                        wordBreak: 'break-word'
                    }}
                >
                    <div>{jsonDetail?.title || jsonDetail?.url || EMPTY_CITATION_DETAIL}</div>
                    {jsonDetail?.url ? (
                        <a href={jsonDetail.url} target="_blank" rel="noreferrer">
                            {jsonDetail.url}
                        </a>
                    ) : null}
                    {extraText ? <div>{extraText}</div> : null}
                </div>
            }
        >
            <Typography.Text style={defaultCitationTextStyle}>{id}</Typography.Text>
        </Popover>
    )
}

/**
 * 正文块：使用 MarkdownRenderer 渲染主回答内容
 */
export const MainTextBlock: React.FC<MainTextBlockProps & MarkdownAnimateProps> = ({
    content,
    status = 'idle',
    citations,
    className,
    citationRender
}) => {
    return (
        <MarkdownRenderer
            className={
                className ||
                'prose w-full min-w-0 max-w-full markdown markdown-here-wrapper [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto'
            }
            content={content || ''}
            status={status}
            citations={citations}
            citationRender={citationRender ?? defaultCitationRender}
        />
    )
}

export default MainTextBlock
