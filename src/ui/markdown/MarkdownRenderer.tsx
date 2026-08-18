import React, { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { MermaidDiagram } from './mdx/Mermaid'
import MermaidBlock from './mdx/mermaid/MermaidBlock'
import rehypeMermaid from './mdx/mermaid/rehypeMermaid'
import { Pluggable, PluggableList } from 'unified'
import remarkMermaid from './mdx/mermaid/remarkMermaid'
import remend from 'remend'
import clsx from 'clsx'
import styled, { keyframes } from 'styled-components'
import { cjk } from './plugins/cjk'
import { ftAnimateStyles } from './animate/styles'
import { AnimatedMarkdown, MarkdownAnimateProps } from './animate/AnimatedMarkdown'
import { animations } from './animate/utils'

const streamdownCaretBlink = keyframes`
    0%, 49% {
        opacity: 1;
    }
    50%, 100% {
        opacity: 0;
    }
`

const Styled = styled.div`
    ${ftAnimateStyles}
`

export type MathEngine = 'KaTeX' | 'MathJax' | 'none'
const mermaidConfig = {
    theme: 'default',
    securityLevel: 'strict' as const,
    flowchart: {
        useMaxWidth: true,
        htmlLabels: false
    },
    sequence: {
        useMaxWidth: true,
        diagramMarginX: 50,
        diagramMarginY: 10
    },
    gantt: {
        useMaxWidth: true
    }
}
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
export const MarkdownRenderer: React.FC<MarkdownRendererProps & MarkdownAnimateProps> = ({
    content,
    status = 'idle',
    className,
    mathEngine = 'KaTeX',
    allowRawSvg = false,
    postProcess,
    citations,
    components,
    citationRender,
    animation = animations.fadeIn,
    animationDuration = '0.5s',
    ...rest
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
            ...cjk.remarkPluginsBefore,
            [remarkGfm, { singleTilde: false }],
            ...cjk.remarkPluginsAfter,
            remarkMath,
            remarkCustomFootnotes,
            remarkMermaid
            // remarkSemiStreaming
        ]
        return list
    }, [])

    const rehypePlugins = useMemo(() => {
        const list: Pluggable[] = [[rehypeMermaid, { mermaidConfig, ssr: false }]]
        if (allowRawSvg) list.push(rehypeRaw)
        list.push(rehypeFootnoteLinks)
        if (mathEngine === 'KaTeX') list.push(rehypeKatex)
        if (mathEngine === 'MathJax') list.push(rehypeMathjax)
        return list
    }, [mathEngine, allowRawSvg])

    const renderText = status === 'streaming' ? remend(displayed) : processedContent
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

    // const Code = useMemo(() => {
    //     return (props: any) => {
    //         const { children, className, node, ...rest } = props
    //         void node
    //         const match = /language-(\w+)/.exec(className || '')
    //         const lang = match?.[1]
    //         if (lang === 'mermaid') {
    //             const raw = Array.isArray(children) ? children.join('') : String(children ?? '')
    //             const code = raw.replace(/\n$/, '')
    //             return <MermaidDiagram code={code} streaming={status === 'streaming'} />
    //         }
    //         return (
    //             <code {...rest} className={className}>
    //                 {children}
    //             </code>
    //         )
    //     }
    // }, [status])

    const Pre = useMemo(() => {
        return (props: any) => {
            const { children, node, ...rest } = props
            void node
            const list = React.Children.toArray(children)
            const hasMermaid = list.some(
                (child) =>
                    React.isValidElement(child) &&
                    (child.type === MermaidDiagram ||
                        (child.props.className as string)?.includes('language-mermaid'))
            )
            if (hasMermaid) {
                return <div {...rest}>{children}</div>
            }
            return <pre {...rest}>{children}</pre>
        }
    }, [])

    const markdownComponents = useMemo(() => {
        return { a: A, MermaidBlock: MermaidBlock, ...(components || {}) }
    }, [A, Pre, components])

    return (
        <Styled
            className={clsx(
                'space-y-4 whitespace-normal *:first:mt-0 *:last:mb-0  ',
                // '*:last:after:inline *:last:after:align-baseline *:last:after:content-[var(--streamdown-caret)]',
                className
            )}
        >
            {status === 'streaming' ? (
                <AnimatedMarkdown
                    {...rest}
                    {...(status === 'streaming'
                        ? { animation: animation, animationDuration: animationDuration }
                        : {
                              animation: undefined,
                              animationDuration: '0s'
                          })}
                    // animation={status !== 'streaming' ? undefined : 'ft-fadeIn'}
                    content={messageContent}
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={rehypePlugins}
                    components={markdownComponents}
                    urlTransform={urlTransform}
                />
            ) : (
                <ReactMarkdown
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={rehypePlugins}
                    components={markdownComponents}
                    urlTransform={urlTransform}
                >
                    {messageContent}
                </ReactMarkdown>
            )}
        </Styled>
    )
}

export default MarkdownRenderer
