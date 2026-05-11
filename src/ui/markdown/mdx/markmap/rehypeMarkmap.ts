/* eslint-disable @typescript-eslint/no-explicit-any */
import { visit } from 'unist-util-visit'
import type { Plugin } from 'unified'

export const rehypeMarkmap: Plugin = () => {
    return (tree) => {
        visit(tree, 'element', (node: any) => {
            if (
                node.tagName !== 'pre' ||
                !node.children?.length ||
                node.children[0].tagName !== 'code'
            ) {
                return
            }

            const codeNode = node.children[0]
            const className = codeNode.properties?.className || []

            if (!className.some((item: string) => item.includes('language-markmap'))) {
                return
            }

            const rawCode = codeNode.children?.[0]?.value || ''
            const isComplete =
                (codeNode as any)?.properties?.['data-is-code-block-complete'] ?? false

            node.type = 'element'
            node.tagName = 'MarkmapBlock'
            node.properties = {
                code: rawCode,
                isComplete
            }
            node.children = []
        })
    }
}

export default rehypeMarkmap
