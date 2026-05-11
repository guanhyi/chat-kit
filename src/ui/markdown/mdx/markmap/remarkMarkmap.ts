import { visit } from 'unist-util-visit'

type RemarkNode = {
    lang?: string
    value?: string
    position?: {
        start: { offset: number }
        end: { offset: number }
    }
    data?: {
        hProperties?: Record<string, unknown>
    }
}

function isCodeBlockComplete(node: RemarkNode, source?: string) {
    if (source && node.position) {
        const fullCodeBlock = source.slice(node.position.start.offset, node.position.end.offset)
        return fullCodeBlock.trim().endsWith('```')
    }

    return (node.value || '').trim().endsWith('```')
}

export const remarkMarkmapCompleteness = () => {
    return (tree: any, file: { value?: string; contents?: string }) => {
        const source = file.value || file.contents

        visit(tree, 'code', (node: RemarkNode) => {
            if (node.lang !== 'markmap') return

            if (!node.data) {
                node.data = { hProperties: {} }
            }

            if (!node.data.hProperties) {
                node.data.hProperties = {}
            }

            node.data.hProperties['data-is-code-block-complete'] = isCodeBlockComplete(node, source)
        })
    }
}

export default remarkMarkmapCompleteness
