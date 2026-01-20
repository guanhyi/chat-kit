import type { Plugin } from 'unified'
import type * as mdast from 'mdast'
import { visit } from 'unist-util-visit'
import type { MermaidConfig } from 'mermaid'
import { mdastToDocx, DocxOptions, ImageDataMap, MermaidDataMap } from './transformer'
import { invariant } from './utils'

export type { DocxOptions }

const normalizeMermaidCode = (code: string) => {
    return code.replace(/\r\n/g, '\n').trim()
}

const parseSvgNumber = (raw: string): number | undefined => {
    const m = raw.trim().match(/^([0-9.]+)(px)?$/i)
    if (!m) return undefined
    const n = Number.parseFloat(m[1]!)
    return Number.isFinite(n) ? n : undefined
}

const parseSvgSize = (svg: string): { width: number; height: number } | undefined => {
    const wh = svg.match(/<svg[^>]*\swidth="([^"]+)"[^>]*\sheight="([^"]+)"/i)
    if (wh) {
        const width = parseSvgNumber(wh[1]!)
        const height = parseSvgNumber(wh[2]!)
        if (width != null && height != null) return { width, height }
    }

    const viewBox = svg.match(/viewBox="([^"]+)"/i)
    if (viewBox) {
        const parts = viewBox[1]!.trim().split(/[\s,]+/)
        if (parts.length >= 4) {
            const width = Number.parseFloat(parts[2]!)
            const height = Number.parseFloat(parts[3]!)
            if (Number.isFinite(width) && Number.isFinite(height)) return { width, height }
        }
    }

    return undefined
}

const svgToPngBytes = async (
    svg: string,
    width: number,
    height: number,
    scale: number,
    backgroundColor: string
): Promise<Uint8Array> => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get canvas context')

    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const svgBase64 = btoa(unescape(encodeURIComponent(svg)))
    const img = new Image()

    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Failed to load svg as image'))
        img.src = 'data:image/svg+xml;base64,' + svgBase64
    })

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Failed to convert canvas to blob'))),
            'image/png'
        )
    })

    return new Uint8Array(await pngBlob.arrayBuffer())
}

const plugin: Plugin<[DocxOptions?]> = function (opts = {}) {
    let images: ImageDataMap = {}
    let mermaids: MermaidDataMap = {}
    let mermaidId = 0

    //@ts-ignore
    this.Compiler = (node) => {
        return mdastToDocx(node as any, opts, images, mermaids)
    }

    return async (node: any) => {
        const imageList: mdast.Image[] = []
        const mermaidCodeList: mdast.Code[] = []

        visit(node, 'image', (node) => {
            imageList.push(node)
        })

        visit(node, 'code', (node) => {
            const codeNode = node as mdast.Code
            if (codeNode.lang?.toLowerCase() === 'mermaid') {
                mermaidCodeList.push(codeNode)
            }
        })

        if (imageList.length > 0) {
            const imageResolver = opts.imageResolver
            invariant(imageResolver, 'options.imageResolver is not defined.')

            const imageDatas = await Promise.all(imageList.map(({ url }) => imageResolver(url)))
            images = imageList.reduce((acc, img, i) => {
                acc[img.url] = imageDatas[i]!
                return acc
            }, {} as ImageDataMap)
        } else {
            images = {}
        }

        if (mermaidCodeList.length > 0) {
            const mermaidOpts = opts.mermaid ?? {}
            const enabled = mermaidOpts.enabled ?? true
            const maxWidth = mermaidOpts.maxWidth ?? 600
            const scale = mermaidOpts.scale ?? 2
            const backgroundColor = mermaidOpts.backgroundColor ?? '#ffffff'

            if (!enabled) {
                mermaids = {}
            } else {
                const codes = Array.from(
                    new Set(
                        mermaidCodeList
                            .map((n) => normalizeMermaidCode(n.value))
                            .filter((c) => c.length > 0)
                    )
                )

                const out: MermaidDataMap = {}
                if (codes.length > 0) {
                    const mermaidModule = await import('mermaid')
                    const mermaidApi = mermaidModule.default

                    // 使用隐藏容器渲染，避免影响页面布局；渲染完成后移除。
                    const container = document.createElement('div')
                    container.style.position = 'fixed'
                    container.style.left = '-10000px'
                    container.style.top = '0'
                    container.style.width = '0'
                    container.style.height = '0'
                    container.style.overflow = 'hidden'
                    document.body.appendChild(container)

                    const prevConfig = mermaidApi.mermaidAPI?.getConfig?.()
                    const defaultConfig: MermaidConfig = {
                        startOnLoad: false,
                        flowchart: { useMaxWidth: true, htmlLabels: false },
                        suppressErrorRendering: true
                    }
                    const userConfig = mermaidOpts.config ?? {}

                    // 初始化会影响全局配置：这里做“临时切换 + 还原”，避免影响页面其它 mermaid 渲染。
                    try {
                        mermaidApi.initialize({
                            ...(prevConfig ?? {}),
                            ...defaultConfig,
                            ...userConfig,
                            flowchart: {
                                ...(prevConfig as any)?.flowchart,
                                ...(defaultConfig as any)?.flowchart,
                                ...(userConfig as any)?.flowchart
                            }
                        })

                        // 顺序渲染，避免 mermaid 全局状态并发导致不确定问题。
                        for (const code of codes) {
                            try {
                                const { svg } = await mermaidApi.render(
                                    `docx-mermaid-${mermaidId++}`,
                                    code,
                                    container
                                )
                                const size = parseSvgSize(svg) ?? {
                                    width: maxWidth,
                                    height: Math.round(maxWidth * 0.75)
                                }

                                let width = Math.max(1, Math.round(size.width))
                                let height = Math.max(1, Math.round(size.height))

                                if (width > maxWidth) {
                                    const ratio = maxWidth / width
                                    width = Math.max(1, Math.round(width * ratio))
                                    height = Math.max(1, Math.round(height * ratio))
                                }

                                const png = await svgToPngBytes(svg, width, height, scale, backgroundColor)
                                out[code] = { svg, png, width, height }
                            } catch {
                                // ignore
                            }
                        }
                    } finally {
                        try {
                            if (prevConfig) {
                                mermaidApi.initialize(prevConfig)
                            }
                        } catch {
                            // ignore
                        }
                        container.remove()
                    }
                }

                mermaids = out
            }
        } else {
            mermaids = {}
        }

        return node
    }
}
export default plugin
