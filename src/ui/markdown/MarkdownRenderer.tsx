import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { MarkdownHooks as ReactMarkdownHooks, defaultUrlTransform } from 'react-markdown'
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
import rehypeMermaidSafe from './plugins/mermaid-safe'

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
    const rawContent = content || ''
    const processedContent = useMemo(
        () => (postProcess ? postProcess(rawContent) : rawContent),
        [postProcess, rawContent]
    )

    const [displayed, setDisplayed] = useState(processedContent)
    const prevContentRef = useRef(rawContent)
    const prevStatusRef = useRef(status)
    const statusRef = useRef(status)

    // 用 ref 承接最新 status，避免流结束后仍有 rAF 回调触发 setState 导致尾段反复渲染
    useEffect(() => {
        statusRef.current = status
    }, [status])

    const onSmoothUpdate = useCallback(
        (text: string) => {
            if (statusRef.current !== 'streaming') return
            setDisplayed(postProcess ? postProcess(text) : text)
        },
        [postProcess]
    )

    const { addChunk, reset } = useSmoothMarkdownStream({
        onUpdate: onSmoothUpdate,
        streamDone: status !== 'streaming',
        initialText: rawContent
    })

    useEffect(() => {
        const newContent = rawContent
        const oldContent = prevContentRef.current
        const prevStatus = prevStatusRef.current

        // 非 streaming：复位内部队列并停止 rAF（渲染直接使用 processedContent，避免尾段被反复触发）
        if (status !== 'streaming') {
            reset(newContent)
            prevContentRef.current = newContent
            prevStatusRef.current = status
            return
        }

        // streaming 起始：以当前 content 作为基线，避免从上一轮尾部继续追加
        if (prevStatus !== 'streaming') {
            reset(newContent)
            prevContentRef.current = newContent
            prevStatusRef.current = status
            return
        }

        const resetRequired = oldContent && newContent && !newContent.startsWith(oldContent)

        if (resetRequired) {
            reset(newContent)
        } else {
            const delta = newContent.substring(oldContent.length)
            if (delta) addChunk(delta)
        }
        prevContentRef.current = newContent
        prevStatusRef.current = status
    }, [rawContent, status, addChunk, reset])

    const remarkPlugins = useMemo(() => {
        const list: any[] = [
            [remarkGfm, { singleTilde: false }],
            remarkMath,
            remarkCustomFootnotes,
            remarkSemiStreaming
        ]
        return list
    }, [])

    const reactId = useId()
    // `useId()` 可能含 `:`，作为 DOM id 时选择器语义复杂，这里替换成 `_` 以降低踩坑概率
    const mermaidPrefix = useMemo(() => `mermaid-${reactId.replaceAll(':', '_')}`, [reactId])

    // streaming 渲染链：保持纯同步（ReactMarkdown 内部走 `runSync`），避免异步插件直接报错/卡顿
    const rehypePluginsSync = useMemo(() => {
        const list: any[] = []
        if (allowRawSvg) list.push(rehypeRaw)
        list.push(rehypeFootnoteLinks)
        if (mathEngine === 'KaTeX') list.push(rehypeKatex)
        if (mathEngine === 'MathJax') list.push(rehypeMathjax)
        return list
    }, [mathEngine, allowRawSvg])

    // 非 streaming：使用 Hooks 版本以支持异步插件（rehype-mermaid 默认会异步渲染）
    const rehypePluginsAsync = useMemo(() => {
        const list: any[] = []
        if (allowRawSvg) list.push(rehypeRaw)
        list.push([rehypeMermaidSafe, { prefix: mermaidPrefix }])
        list.push(rehypeFootnoteLinks)
        if (mathEngine === 'KaTeX') list.push(rehypeKatex)
        if (mathEngine === 'MathJax') list.push(rehypeMathjax)
        return list
    }, [mathEngine, allowRawSvg, mermaidPrefix])

    const renderText = status === 'streaming' ? displayed : processedContent
    const messageContent = useMemo(() => {
        return citations ? transformCitations(renderText, citations.length) : renderText
    }, [renderText, citations, citations?.length])

    const urlTransform = useCallback((value: string) => {
        if (value.startsWith('data:image/png') || value.startsWith('data:image/jpeg')) return value
        return defaultUrlTransform(value)
    }, [])

    const A = useMemo(() => {
        return (props: any) => <Link citations={citations} render={citationRender} {...props} />
    }, [citations, citationRender])

    const markdownComponents = useMemo(() => {
        return { a: A, ...(components || {}) }
    }, [A, components])

    const markdownFallback = useMemo(() => {
        // Mermaid 渲染（异步）尚未完成时，先用同步链路把 Markdown 呈现出来，避免空白闪烁
        return (
            <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePluginsSync}
                components={markdownComponents}
                urlTransform={urlTransform}
            >
                {messageContent}
            </ReactMarkdown>
        )
    }, [messageContent, markdownComponents, rehypePluginsSync, remarkPlugins, urlTransform])

    return (
        <div className={className}>
            {status === 'streaming' ? (
                <ReactMarkdown
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={rehypePluginsSync}
                    components={markdownComponents}
                    urlTransform={urlTransform}
                >
                    {messageContent}
                </ReactMarkdown>
            ) : (
                <ReactMarkdownHooks
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={rehypePluginsAsync}
                    components={markdownComponents}
                    urlTransform={urlTransform}
                    fallback={markdownFallback}
                >
                    {messageContent}
                </ReactMarkdownHooks>
            )}
        </div>
    )
}

export default MarkdownRenderer
