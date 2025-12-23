import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeMathjax from 'rehype-mathjax'
import rehypeRaw from 'rehype-raw'
import 'katex/dist/katex.min.css'
import 'katex/dist/contrib/mhchem'
import 'katex/dist/contrib/copy-tex'
import { remarkCustomFootnotes, rehypeFootnoteLinks } from './plugins/footnote'
import { transformCitations } from './utils'
import { useSmoothMarkdownStream } from './useSmoothMarkdownStream'
import { remarkSemiStreaming } from './plugins/semi-streaming'
import { Link, type CitationProps } from './mdx/Link'

export type MathEngine = 'KaTeX' | 'MathJax' | 'none'

export interface MarkdownRendererProps {
    content: string
    status?: 'streaming' | 'success' | 'idle'
    className?: string
    mathEngine?: MathEngine
    allowRawSvg?: boolean
    postProcess?: (text: string) => string
    citations?: any[]
    components?: any
    citationRender?: (props: CitationProps) => JSX.Element
}

/**
 * 新版 Markdown 渲染容器
 * - 支持流式平滑渲染（配合 useSmoothMarkdownStream）
 * - 兼容 KaTeX / MathJax、脚注、原始 HTML（受控）
 * - 不依赖业务组件库，可在多个项目中复用
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
    content,
    status = 'idle',
    className,
    mathEngine = 'KaTeX',
    allowRawSvg = false,
    postProcess,
    citations,
    components,
    citationRender
}) => {
    const [displayed, setDisplayed] = useState(
        postProcess ? postProcess(content || '') : content || ''
    )
    const prevContentRef = useRef(content)

    const onSmoothUpdate = useCallback(
        (text: string) => setDisplayed(postProcess ? postProcess(text) : text),
        [postProcess]
    )

    const { addChunk, reset } = useSmoothMarkdownStream({
        onUpdate: onSmoothUpdate,
        streamDone: status !== 'streaming',
        initialText: content || ''
    })

    useEffect(() => {
        const newContent = content || ''
        const oldContent = prevContentRef.current || ''
        const resetRequired = oldContent && newContent && !newContent.startsWith(oldContent)

        // 关键：当流结束（或非 streaming 状态）时，用 reset 同步 smooth-stream 的内部状态，
        // 避免尾部 rAF 还在触发 onUpdate，导致显示内容在「最终文本」与「内部缓冲文本」之间来回抖动。
        if (status !== 'streaming') {
            reset(newContent)
            prevContentRef.current = newContent
            return
        }

        if (resetRequired) {
            reset(newContent)
        } else {
            const delta = newContent.substring(oldContent.length)
            if (delta) addChunk(delta)
        }
        prevContentRef.current = newContent
    }, [content, status, addChunk, reset])

    const remarkPlugins = useMemo(() => {
        const list: any[] = [
            [remarkGfm, { singleTilde: false }],
            remarkMath,
            remarkCustomFootnotes,
            remarkSemiStreaming
        ]
        return list
    }, [])

    const rehypePlugins = useMemo(() => {
        const list: any[] = []
        if (allowRawSvg) list.push(rehypeRaw)
        list.push(rehypeFootnoteLinks)
        if (mathEngine === 'KaTeX') list.push(rehypeKatex)
        if (mathEngine === 'MathJax') list.push(rehypeMathjax)
        return list
    }, [mathEngine, allowRawSvg])

    const messageContent = useMemo(() => {
        return citations?.length ? transformCitations(displayed, citations.length) : displayed
    }, [displayed, citations?.length])

    const urlTransform = useCallback((value: string) => {
        if (value.startsWith('data:image/png') || value.startsWith('data:image/jpeg')) return value
        return defaultUrlTransform(value)
    }, [])

    const A = useMemo(() => {
        return (props: any) => <Link citations={citations} render={citationRender} {...props} />
    }, [citations, citationRender])

    return (
        <div className={className}>
            <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
                components={{ a: A, ...(components || {}) }}
                urlTransform={urlTransform}
            >
                {messageContent}
            </ReactMarkdown>
        </div>
    )
}

export default MarkdownRenderer
