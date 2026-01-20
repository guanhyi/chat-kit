import type { Plugin } from 'unified'
import type * as mdast from 'mdast'
import { visit } from 'unist-util-visit'
import { mdastToDocx, DocxOptions, ImageDataMap } from './transformer'
import { invariant } from './utils'
import { renderMermaidToPng } from './mermaid'

export type { DocxOptions }

const plugin: Plugin<[DocxOptions?]> = function (opts = {}) {
    let images: ImageDataMap = {}

    //@ts-ignore
    this.Compiler = (node) => {
        return mdastToDocx(node as any, opts, images)
    }

    return async (node: any) => {
        const imageList: mdast.Image[] = []
        const mermaidCodeList: mdast.Code[] = []
        visit(node, 'image', (node) => {
            imageList.push(node)
        })
        visit(node, 'code', (node) => {
            if (node.lang === 'mermaid') {
                mermaidCodeList.push(node)
            }
        })

        // 同一个 processor 可能会被重复调用（多次导出），这里每次都重置，避免“脏数据”累积
        images = {}

        // 1) mermaid：预先渲染成 PNG，把二进制挂到节点上，transformer 再读取并写入 docx
        // 说明：transformer 目前是同步遍历，无法在 buildCode 时 await 渲染，所以需要在这里做预处理。
        if (mermaidCodeList.length > 0) {
            for (const codeNode of mermaidCodeList) {
                const code = codeNode.value ?? ''
                if (!code.trim()) continue
                try {
                    const png = await renderMermaidToPng(code)
                    ;(codeNode as any).data = (codeNode as any).data ?? {}
                    ;(codeNode as any).data.docxMermaid = png
                } catch (err) {
                    // mermaid 渲染失败则降级为普通代码块导出
                    console.warn('[md-to-doc] mermaid 导出失败，已降级为代码块：', err)
                }
            }
        }

        // 2) 普通图片：依赖用户提供 imageResolver
        if (imageList.length > 0) {
            const imageResolver = opts.imageResolver
            invariant(imageResolver, 'options.imageResolver is not defined.')

            const imageDatas = await Promise.all(imageList.map(({ url }) => imageResolver(url)))
            images = imageList.reduce((acc, img, i) => {
                acc[img.url] = imageDatas[i]!
                return acc
            }, {} as ImageDataMap)
        }
        return node
    }
}
export default plugin
