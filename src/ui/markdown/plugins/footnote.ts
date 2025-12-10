import { Node } from 'unist'
import { SKIP, visit } from 'unist-util-visit'

interface FootnoteLink {
    alt?: string
    title?: string
    url: string
}

// 自定义 remark 插件：收集脚注中的链接
// eslint-disable-next-line unicorn/consistent-function-scoping
export const remarkCustomFootnotes = () => (tree: any, file: any) => {
    const footnoteLinks = new Map()

    visit(tree, 'footnoteDefinition', (node) => {
        let linkData: FootnoteLink | null = null

        // 查找第一个 link 类型的子节点
        visit(node, 'link', (linkNode) => {
            if (linkData) return SKIP

            const textNode = (linkNode.children as Node[]).find((n: Node) => n.type === 'text')

            linkData = {
                alt: (textNode as any)?.value || '',
                title: (textNode as any)?.value || '',
                url: (linkNode as any).url
            }

            return SKIP
        })

        if (linkData) {
            footnoteLinks.set((node as any).identifier, linkData)
        }
    })

    file.data.footnoteLinks = Object.fromEntries(footnoteLinks)
}

// rehype 插件：把脚注元数据挂到 DOM 上，方便前端渲染
// eslint-disable-next-line unicorn/consistent-function-scoping
export const rehypeFootnoteLinks = () => (tree: any, file: any) => {
    const linksData: Record<string, FootnoteLink> = file.data.footnoteLinks || {}

    visit(tree, 'element', (node: any) => {
        if (
            node.tagName === 'section' &&
            (node.properties.className || []).includes('footnotes')
        ) {
            const sortedLinks = Object.entries(linksData)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([id, data]) => ({ id, ...data }))
            node.properties['data-footnote-links'] = JSON.stringify(sortedLinks)
        }

        if (node.tagName === 'sup') {
            const link = (node.children as any[]).find((n) => n.tagName === 'a')

            if (link) {
                const linkRefIndex = (link.properties?.id as string | undefined)
                    ?.replace(/^user-content-fnref-/, '')?.[0]

                if (linkRefIndex !== undefined) {
                    link.properties['data-link'] = JSON.stringify(linksData[linkRefIndex])
                }
            }
        }
    })
}

