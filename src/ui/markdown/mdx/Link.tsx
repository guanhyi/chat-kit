import { useMemo } from 'react'

export interface CitationItem {
    id?: string
    title?: string
    url?: string
    extra?: any
}

export interface CitationProps {
    citationDetail?: CitationItem
    citations?: CitationItem[]
    href?: string
    id: string
    inSup?: boolean
    // 由上层自定义引用渲染，例如弹出卡片或 Badge
    render?: (props: CitationProps) => JSX.Element
}

type AProps = JSX.IntrinsicElements['a']

export interface LinkProps extends AProps {
    'aria-describedby'?: string
    citations?: CitationItem[]
    'data-footnote-ref'?: boolean
    'data-link'?: string
    id?: string
    node?: any
    render?: (props: CitationProps) => JSX.Element
}

/**
 * 自定义链接组件：
 * - 识别形如 `citation-1` 的脚注链接；
 * - 若提供 render，则交给外部渲染（例如渲染 Badge 并弹出引用卡片）；
 * - 否则退回为普通的 <a>。
 */
export const Link = (props: LinkProps) => {
    const match = useMemo(() => props.href?.match(/citation-(\d+)/), [props.href])
    const citations = useMemo(() => props.citations, [props.citations])

    const detail = useMemo(() => {
        const _match = match
        const _citations = citations

        if (_match && _citations) {
            const index = Number.parseInt(_match[1]) - 1
            return _citations?.[index]
        }
        return undefined
    }, [match, citations])

    if (match && props.render) {
        return props.render({
            citationDetail: detail,
            citations,
            href: props.href,
            id: match[1],
            inSup: false,
            render: props.render
        })
    }

    return <a {...props} />
}

