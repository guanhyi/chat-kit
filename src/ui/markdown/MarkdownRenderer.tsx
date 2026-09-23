import React, { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

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
import type { MermaidProps } from './mdx/mermaid/types'
import rehypeMermaid from './mdx/mermaid/rehypeMermaid'
import MarkmapBlock from './mdx/markmap/MarkmapBlock'
import rehypeMarkmap from './mdx/markmap/rehypeMarkmap'
import { Pluggable, PluggableList } from 'unified'
import remarkMermaid from './mdx/mermaid/remarkMermaid'
import remarkMarkmap from './mdx/markmap/remarkMarkmap'
import remend from 'remend'
import clsx from 'clsx'
import styled, { keyframes } from 'styled-components'
import { cjk } from './plugins/cjk'
import { ftAnimateStyles } from './animate/styles'
import { AnimatedMarkdown, MarkdownAnimateProps } from './animate/AnimatedMarkdown'
import { MarkdownRenderBoundary } from './MarkdownRenderBoundary'
import { SafeCodeBlock } from './SafeCodeBlock'
import {
    MarkdownTable,
    MarkdownTableCell,
    MarkdownTableHeaderCell
} from './mdx/MarkdownTable'

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

    /* 代码块：宽度贴齐气泡，超宽时在块内横向滚动 */
    .chat-code-scroll {
        max-width: 100%;
        min-width: 0;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        scrollbar-width: thin;
        scrollbar-color: rgba(148, 163, 184, 0.9) transparent;
    }

    .chat-code-scroll::-webkit-scrollbar {
        height: 8px;
        width: 8px;
    }

    .chat-code-scroll::-webkit-scrollbar-track {
        background: transparent;
    }

    .chat-code-scroll::-webkit-scrollbar-thumb {
        background: rgba(148, 163, 184, 0.85);
        border-radius: 999px;
    }

    .chat-code-scroll::-webkit-scrollbar-thumb:hover {
        background: rgba(100, 116, 139, 0.95);
    }

    .chat-code-scroll > pre {
        margin-top: 0;
        margin-bottom: 0;
        max-width: none;
        width: max-content;
        white-space: pre;
        overflow: visible;
        word-break: normal;
        overflow-wrap: normal;
    }
`

export type MathEngine = 'KaTeX' | 'none'
export type MermaidRendererProps = MermaidProps
export type MermaidRendererComponent = React.ComponentType<MermaidRendererProps>

const mermaidConfig = {
    theme: 'default',
    flowchart: {
        useMaxWidth: true,
        htmlLabels: true
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
    mermaidRenderer?: MermaidRendererComponent
    citationRender?: (props: CitationProps) => JSX.Element
    /** 流式切分方式。默认 diff：只动画新增片段，避免 char 按 UTF-16 拆开 emoji */
    sep?: 'char' | 'word' | 'diff'
}

/**
 * 新版 Markdown 渲染容器
 * - 支持流式平滑渲染（配合 useSmoothMarkdownStream）
 * - 支持 KaTeX、脚注、原始 HTML（受控）
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
    mermaidRenderer,
    citationRender,
    // 默认不做入场动画。虚拟列表回收再挂上时，fadeIn 会让已出现的正文整段重闪。
    animation = undefined,
    animationDuration = '0s',
    sep = 'diff',
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

    const onSmoothUpdate = useCallback(
        (text: string) => {
            // 流结束后仍要接着吐完积压的字，不能在这里把回调丢掉。
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

        // 刚从流式切到完成：不要整段替换。队列里还没吐完的字继续按结束加速补完。
        if (status !== 'streaming') {
            if (prevStatus === 'streaming' && newContent.startsWith(prevContentRef.current)) {
                const delta = newContent.substring(prevContentRef.current.length)
                if (delta) addChunk(delta)
            } else if (newContent !== prevContentRef.current) {
                reset(newContent)
                setDisplayed(processedContent)
            }
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
            remarkMermaid,
            remarkMarkmap
            // remarkSemiStreaming
        ]
        return list
    }, [])

    const rehypePlugins = useMemo(() => {
        const list: Pluggable[] = [[rehypeMermaid, { mermaidConfig, ssr: false }], rehypeMarkmap]
        if (allowRawSvg) list.push(rehypeRaw)
        list.push(rehypeFootnoteLinks)
        if (mathEngine === 'KaTeX') list.push(rehypeKatex)
        return list
    }, [mathEngine, allowRawSvg])

    const catchingUp = status !== 'streaming' && displayed !== processedContent
    const renderText = status === 'streaming' || catchingUp ? remend(displayed) : processedContent
    const messageContent = useMemo(() => {
        return citations ? transformCitations(renderText, citations) : renderText
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
            const { children, node, className: preClassName, ...rest } = props
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
            // 滚动容器与内容分离：
            // - 外层宽度 = 气泡可用宽度，overflow-x:auto → 超宽时出现横向滚动条
            // - 内层 pre 用 w-max + whitespace-pre 按真实内容撑开，不换行
            return <SafeCodeBlock className={preClassName}>{children}</SafeCodeBlock>
        }
    }, [])

    const Table = useMemo(() => {
        return (props: any) => <MarkdownTable {...props} streaming={status === 'streaming'} />
    }, [status])

    const MermaidBlockRenderer = useMemo(() => {
        const Renderer = mermaidRenderer ?? MermaidBlock

        return (props: MermaidRendererProps) => (
            <Renderer {...props} streaming={status === 'streaming'} />
        )
    }, [mermaidRenderer, status])

    const markdownComponents = useMemo(() => {
        return {
            a: A,
            pre: Pre,
            table: Table,
            th: MarkdownTableHeaderCell,
            td: MarkdownTableCell,
            MarkmapBlock: MarkmapBlock,
            ...(components || {}),
            MermaidBlock: MermaidBlockRenderer
        }
    }, [A, Pre, Table, MermaidBlockRenderer, components])

    const markdownTree = status === 'streaming' ? (
                <AnimatedMarkdown
                    sep={sep}
                    {...rest}
                    animation={animation}
                    animationDuration={animation ? animationDuration : '0s'}
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
            )

    return (
        <Styled
            className={clsx(
                'min-w-0 max-w-full space-y-4 whitespace-normal break-words *:first:mt-0 *:last:mb-0',
                // '*:last:after:inline *:last:after:align-baseline *:last:after:content-[var(--streamdown-caret)]',
                className
            )}
        >
            <MarkdownRenderBoundary resetKey={messageContent} fallbackText={messageContent}>
                {markdownTree}
            </MarkdownRenderBoundary>
        </Styled>
    )
}

export default MarkdownRenderer
