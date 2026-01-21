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

type ExportableSvg = {
    svg: SVGSVGElement
    contentWidth: number
    contentHeight: number
}

type ExportCanvasOptions = {
    /** 背景色（默认白色） */
    backgroundColor?: string
    /** 内容留白，避免 stroke/阴影被裁切 */
    padding?: number
    /** 最小长边像素（防止导出太小导致“糊”） */
    minLongSidePx?: number
    /** 最大长边像素（避免 Canvas 过大） */
    maxLongSidePx?: number
    /** 限制总像素数，避免内存爆炸 */
    maxTotalPixels?: number
}

function ensureSvgNamespaces(svg: SVGSVGElement) {
    if (!svg.getAttribute('xmlns')) {
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    }
    if (!svg.getAttribute('xmlns:xlink')) {
        svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    }
}

function resetPanZoomTransform(svg: SVGSVGElement) {
    const viewport = svg.querySelector('g.svg-pan-zoom_viewport') as SVGGElement | null
    if (viewport) {
        // 清理 svg-pan-zoom 运行时 transform，避免导出被当前缩放/平移影响
        viewport.removeAttribute('transform')
    }
}

function measureSvgContentBox(svg: SVGSVGElement) {
    const wrapper = document.createElement('div')
    wrapper.style.position = 'fixed'
    wrapper.style.left = '-10000px'
    wrapper.style.top = '-10000px'
    wrapper.style.width = '10000px'
    wrapper.style.height = '10000px'
    wrapper.style.overflow = 'hidden'
    wrapper.style.opacity = '0'
    wrapper.style.pointerEvents = 'none'

    document.body.appendChild(wrapper)
    wrapper.appendChild(svg)
    try {
        const target = (svg.querySelector('g.svg-pan-zoom_viewport') as SVGGElement | null) ?? svg
        return target.getBBox()
    } finally {
        wrapper.remove()
    }
}

function buildExportableSvg(svgElement: SVGElement, padding: number): ExportableSvg | null {
    const svgRoot = svgElement instanceof SVGSVGElement ? svgElement : svgElement.ownerSVGElement
    if (!svgRoot) return null

    const cloned = svgRoot.cloneNode(true) as SVGSVGElement
    ensureSvgNamespaces(cloned)
    resetPanZoomTransform(cloned)

    // 移除响应式尺寸，避免 bbox/导出时出现不稳定 viewport（例如 300x150 或被 max-width 限制）
    cloned.removeAttribute('width')
    cloned.removeAttribute('height')
    cloned.style.width = ''
    cloned.style.height = ''
    cloned.style.maxWidth = ''

    let bbox: DOMRect
    try {
        bbox = measureSvgContentBox(cloned)
    } catch (err) {
        console.error('Failed to measure SVG bbox:', err)
        return null
    }

    if (
        !Number.isFinite(bbox.width) ||
        !Number.isFinite(bbox.height) ||
        bbox.width <= 0 ||
        bbox.height <= 0
    ) {
        return null
    }

    const x = bbox.x - padding
    const y = bbox.y - padding
    const width = bbox.width + padding * 2
    const height = bbox.height + padding * 2

    cloned.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)
    cloned.setAttribute('preserveAspectRatio', 'xMidYMid meet')

    return { svg: cloned, contentWidth: width, contentHeight: height }
}

function calcExportSize(contentWidth: number, contentHeight: number, opts: Required<ExportCanvasOptions>) {
    const longSide = Math.max(contentWidth, contentHeight)
    if (!Number.isFinite(longSide) || longSide <= 0) {
        return { width: 0, height: 0 }
    }

    let scale = 1
    if (longSide < opts.minLongSidePx) {
        scale = opts.minLongSidePx / longSide
    }
    if (longSide * scale > opts.maxLongSidePx) {
        scale = opts.maxLongSidePx / longSide
    }

    const totalPixels = contentWidth * contentHeight * scale * scale
    if (Number.isFinite(totalPixels) && totalPixels > opts.maxTotalPixels) {
        const areaScale = Math.sqrt(opts.maxTotalPixels / (contentWidth * contentHeight))
        if (Number.isFinite(areaScale)) {
            scale = Math.min(scale, areaScale)
        }
    }

    if (!Number.isFinite(scale) || scale <= 0) scale = 1

    return {
        width: Math.max(1, Math.round(contentWidth * scale)),
        height: Math.max(1, Math.round(contentHeight * scale))
    }
}

async function exportSvgElementToCanvas(svgElement: SVGElement, options: ExportCanvasOptions = {}) {
    const opts: Required<ExportCanvasOptions> = {
        backgroundColor: options.backgroundColor ?? '#ffffff',
        padding: options.padding ?? 16,
        minLongSidePx: options.minLongSidePx ?? 4096,
        maxLongSidePx: options.maxLongSidePx ?? 8192,
        maxTotalPixels: options.maxTotalPixels ?? 25_000_000
    }

    // bbox 计算/最终光栅化都依赖字体度量，尽量等待字体加载完成，避免导出时文字被裁切或排版变化
    try {
        await (document as any).fonts?.ready
    } catch {
        // ignore
    }

    const exportable = buildExportableSvg(svgElement, opts.padding)
    if (!exportable) {
        throw new Error('Failed to build exportable svg')
    }

    const { width, height } = calcExportSize(exportable.contentWidth, exportable.contentHeight, opts)
    if (width <= 0 || height <= 0) {
        throw new Error('Invalid export size')
    }

    exportable.svg.setAttribute('width', String(width))
    exportable.svg.setAttribute('height', String(height))

    const svgData = new XMLSerializer().serializeToString(exportable.svg)
    const img = new Image()

    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Failed to load svg as image'))
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
    })

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get canvas context')

    ctx.fillStyle = opts.backgroundColor
    ctx.fillRect(0, 0, width, height)

    ctx.drawImage(img, 0, 0, width, height)
    return canvas
}

const downloadPng = async (data: { id: string }) => {
    const { id } = data
    const svgElement = document.querySelector(id) as SVGElement | null
    if (!svgElement) return false
    try {
        const canvas = await exportSvgElementToCanvas(svgElement)
        const pngData = canvas.toDataURL('image/png')

        const link = document.createElement('a')
        link.download = 'image.png'
        link.href = pngData
        link.click()
        return true
    } catch (err) {
        console.error('Download failed:', err)
        return false
    }
}

async function svgToPngAndCopy(data: { id: string }) {
    const { id } = data
    const svgElement = document.querySelector(id) as SVGElement | null
    if (!svgElement) return false
    try {
        const canvas = await exportSvgElementToCanvas(svgElement)
        const pngBlob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (b) => (b ? resolve(b) : reject(new Error('Failed to convert canvas to blob'))),
                'image/png'
            )
        })

        await navigator.clipboard.write([
            new ClipboardItem({
                'image/png': pngBlob
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
