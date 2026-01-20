import { unified } from 'unified'
import rehypeParse from 'rehype-parse'
import { Components, toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import Svg from './components/svg'

let _mermaidId = 0

const getMermaidId = () => {
    return `mermaid-${_mermaidId++}`
}

type ParseSvgToJsxOptions = {
    noRest?: boolean
}

function setSvgProp(hast: any, key: string, value: unknown): boolean {
    if (!hast || typeof hast !== 'object') return false
    const children = (hast as any).children
    if (!Array.isArray(children)) return false

    for (const child of children) {
        if (child?.type === 'element' && child?.tagName === 'svg') {
            child.properties = child.properties || {}
            child.properties[key] = value
            return true
        }
        if (setSvgProp(child, key, value)) return true
    }

    return false
}

const parseSvgToJsx = (svgString: string, options: ParseSvgToJsxOptions = {}) => {
    if (!svgString) return null
    try {
        const processor = unified().use(rehypeParse, { fragment: true, space: 'svg' })
        const hast = processor.parse(svgString)
        if (options.noRest) {
            setSvgProp(hast, 'noRest', true)
        }
        const jsxElement = toJsxRuntime(hast, {
            Fragment,
            jsx,
            jsxs,
            passKeys: true, // 保留所有属性
            // mermaid 生成的 SVG 可能包含不完整/不兼容的内联 style，避免因此导致整张图渲染失败
            ignoreInvalidStyle: true,
            components: {
                svg: Svg
            } as Components
        })
        return jsxElement
    } catch (err) {
        console.error('Failed to parse SVG to JSX:', err)
        return null
    }
}

function parseSvgLength(value: string | null): number | null {
    if (!value) return null
    const v = value.trim()
    if (!v || v.endsWith('%')) return null
    const n = parseFloat(v)
    if (!Number.isFinite(n) || n <= 0) return null
    return n
}

function parseViewBoxSize(viewBox: string | null): { width: number; height: number } | null {
    if (!viewBox) return null
    const parts = viewBox
        .trim()
        .split(/[\s,]+/)
        .map((p) => parseFloat(p))
    if (parts.length !== 4) return null
    const width = parts[2]
    const height = parts[3]
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
    return { width, height }
}

function getSvgSize(svg: SVGSVGElement): { width: number; height: number } | null {
    const vb = parseViewBoxSize(svg.getAttribute('viewBox'))
    if (vb) return vb
    const width = parseSvgLength(svg.getAttribute('width'))
    const height = parseSvgLength(svg.getAttribute('height'))
    if (width && height) return { width, height }
    return null
}

function calcExportScale(
    base: { width: number; height: number },
    options?: { targetMaxSidePx?: number; maxCanvasSidePx?: number; maxTotalPixels?: number }
) {
    const targetMaxSidePx = options?.targetMaxSidePx ?? 3000
    const maxCanvasSidePx = options?.maxCanvasSidePx ?? 8192
    const maxTotalPixels = options?.maxTotalPixels ?? 20_000_000

    const baseMaxSide = Math.max(base.width, base.height)
    let scale = 1

    // 小图：按 mermaid 的真实尺寸（viewBox）放大到接近目标边长，保证“高清”
    if (baseMaxSide > 0 && baseMaxSide < targetMaxSidePx) {
        scale = targetMaxSidePx / baseMaxSide
    }

    // 大图：为了避免 Canvas 尺寸过大导致失败，需要在必要时允许缩小
    if (baseMaxSide * scale > maxCanvasSidePx) {
        scale = maxCanvasSidePx / baseMaxSide
    }

    const totalPixels = base.width * base.height * scale * scale
    if (Number.isFinite(totalPixels) && totalPixels > maxTotalPixels) {
        const areaScale = Math.sqrt(maxTotalPixels / (base.width * base.height))
        scale = Math.min(scale, areaScale)
    }

    if (!Number.isFinite(scale) || scale <= 0) return 1
    return scale
}

async function svgStringToPngBlob(options: {
    svgString: string
    backgroundColor?: string
    targetMaxSidePx?: number
    maxCanvasSidePx?: number
    maxTotalPixels?: number
}): Promise<{ blob: Blob; width: number; height: number } | null> {
    const { svgString, backgroundColor = '#ffffff' } = options
    const parser = new DOMParser()
    const doc = parser.parseFromString(svgString, 'image/svg+xml')
    const svg = doc.querySelector('svg') as SVGSVGElement | null
    if (!svg) return null

    const size = getSvgSize(svg)
    if (!size) return null

    const scale = calcExportScale(size, options)
    const outWidth = Math.max(1, Math.round(size.width * scale))
    const outHeight = Math.max(1, Math.round(size.height * scale))

    // 导出时强制写死像素尺寸，避免受页面里 width="100%" / height={svgHeight} 等影响
    if (!svg.getAttribute('xmlns')) {
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    }
    svg.setAttribute('width', String(outWidth))
    svg.setAttribute('height', String(outHeight))

    const svgData = new XMLSerializer().serializeToString(svg)
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    try {
        const img = new Image()
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = () => reject(new Error('Failed to load SVG image'))
            img.src = url
        })

        const canvas = document.createElement('canvas')
        canvas.width = outWidth
        canvas.height = outHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Failed to get canvas context')

        // 默认白底（避免透明背景在一些场景看起来像“黑底/棋盘格”）
        ctx.fillStyle = backgroundColor
        ctx.fillRect(0, 0, outWidth, outHeight)

        ctx.imageSmoothingEnabled = true
        ;(ctx as any).imageSmoothingQuality = 'high'

        ctx.drawImage(img, 0, 0, outWidth, outHeight)

        const pngBlob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(resolve, 'image/png')
        })
        if (!pngBlob) return null

        return { blob: pngBlob, width: outWidth, height: outHeight }
    } finally {
        URL.revokeObjectURL(url)
    }
}

export function svgToPng(
    svgElement: SVGElement,
    width: number,
    height: number,
    callback: (pngData: string) => void
): void {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        throw new Error('Failed to get canvas context')
    }

    const svgData = new XMLSerializer().serializeToString(svgElement)
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    const img = new Image()

    img.onload = function () {
        try {
            ctx.drawImage(img, 0, 0, width, height)
            const pngData = canvas.toDataURL('image/png')
            callback(pngData)
        } finally {
            URL.revokeObjectURL(url)
        }
    }
    img.onerror = function () {
        URL.revokeObjectURL(url)
        throw new Error('Failed to load SVG image')
    }
    img.src = url
}

const downloadPng = async (data: {
    svgString: string
    fileName?: string
    backgroundColor?: string
    targetMaxSidePx?: number
    maxCanvasSidePx?: number
    maxTotalPixels?: number
}) => {
    const { svgString, fileName = 'image.png' } = data
    const res = await svgStringToPngBlob(data)
    if (!res) return false

    const url = URL.createObjectURL(res.blob)
    const link = document.createElement('a')
    link.download = fileName
    link.href = url
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    return true
}

async function svgToPngAndCopy(data: {
    svgString: string
    backgroundColor?: string
    targetMaxSidePx?: number
    maxCanvasSidePx?: number
    maxTotalPixels?: number
}) {
    try {
        const res = await svgStringToPngBlob(data)
        if (!res) return false

        if (!navigator.clipboard?.write) {
            console.error('copy failed: navigator.clipboard.write is not available')
            return false
        }
        if (typeof ClipboardItem === 'undefined') {
            console.error('copy failed: ClipboardItem is not available')
            return false
        }

        await navigator.clipboard.write([
            new ClipboardItem({
                'image/png': res.blob
            })
        ])
        return true
    } catch (error) {
        console.error('copy failed:', error)
        return false
    }
}

export { downloadPng, svgToPngAndCopy }

export { getMermaidId, parseSvgToJsx }
