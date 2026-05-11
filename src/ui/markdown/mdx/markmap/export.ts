const SVG_XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>'
const PNG_MIME_TYPE = 'image/png'
const DEFAULT_PNG_FILE_NAME = 'markmap.png'
const DEFAULT_EXPORT_PADDING = 16
const PNG_BACKGROUND_COLOR = '#ffffff'
const MIN_EXPORT_LONG_SIDE_PX = 4096
const MAX_EXPORT_LONG_SIDE_PX = 8192
const MAX_EXPORT_TOTAL_PIXELS = 25_000_000

type ExportableSvg = {
    svg: SVGSVGElement
    contentWidth: number
    contentHeight: number
}

type ExportCanvasOptions = {
    backgroundColor?: string
    padding?: number
    minLongSidePx?: number
    maxLongSidePx?: number
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

function resetRootGroupTransform(svg: SVGSVGElement) {
    const rootGroup = svg.querySelector(':scope > g') as SVGGElement | null
    if (!rootGroup) return
    rootGroup.removeAttribute('transform')
}

function getMeasureTarget(svg: SVGSVGElement) {
    return (svg.querySelector(':scope > g') as SVGGElement | null) ?? svg
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
        return getMeasureTarget(svg).getBBox()
    } finally {
        wrapper.remove()
    }
}

function buildExportableSvg(svgElement: SVGElement, padding: number): ExportableSvg | null {
    const svgRoot = svgElement instanceof SVGSVGElement ? svgElement : svgElement.ownerSVGElement
    if (!svgRoot) return null

    const cloned = svgRoot.cloneNode(true) as SVGSVGElement
    ensureSvgNamespaces(cloned)
    resetRootGroupTransform(cloned)
    cloned.removeAttribute('width')
    cloned.removeAttribute('height')
    cloned.style.width = ''
    cloned.style.height = ''
    cloned.style.maxWidth = ''

    let bbox: DOMRect
    try {
        bbox = measureSvgContentBox(cloned)
    } catch (error) {
        console.error('Failed to measure SVG bbox:', error)
        return null
    }

    if (bbox.width <= 0 || bbox.height <= 0) {
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

function calcExportSize(
    contentWidth: number,
    contentHeight: number,
    options: Required<ExportCanvasOptions>
) {
    const longSide = Math.max(contentWidth, contentHeight)
    if (longSide <= 0) {
        return { width: 0, height: 0 }
    }

    let scale = 1
    if (longSide < options.minLongSidePx) {
        scale = options.minLongSidePx / longSide
    }

    if (longSide * scale > options.maxLongSidePx) {
        scale = options.maxLongSidePx / longSide
    }

    const totalPixels = contentWidth * contentHeight * scale * scale
    if (totalPixels > options.maxTotalPixels) {
        const areaScale = Math.sqrt(options.maxTotalPixels / (contentWidth * contentHeight))
        scale = Math.min(scale, areaScale)
    }

    return {
        width: Math.max(1, Math.round(contentWidth * scale)),
        height: Math.max(1, Math.round(contentHeight * scale))
    }
}

async function waitForFonts() {
    try {
        await (document as Document & { fonts?: { ready: Promise<void> } }).fonts?.ready
    } catch {
        // ignore font readiness errors
    }
}

function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
}

function serializeSvg(svg: SVGSVGElement) {
    return `${SVG_XML_HEADER}\n${new XMLSerializer().serializeToString(svg)}\n`
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) =>
                blob ? resolve(blob) : reject(new Error('Failed to convert canvas to blob')),
            type
        )
    })
}

async function exportSvgElementToCanvas(svgElement: SVGElement, options: ExportCanvasOptions = {}) {
    const resolvedOptions: Required<ExportCanvasOptions> = {
        backgroundColor: options.backgroundColor ?? PNG_BACKGROUND_COLOR,
        padding: options.padding ?? DEFAULT_EXPORT_PADDING,
        minLongSidePx: options.minLongSidePx ?? MIN_EXPORT_LONG_SIDE_PX,
        maxLongSidePx: options.maxLongSidePx ?? MAX_EXPORT_LONG_SIDE_PX,
        maxTotalPixels: options.maxTotalPixels ?? MAX_EXPORT_TOTAL_PIXELS
    }

    await waitForFonts()

    const exportable = buildExportableSvg(svgElement, resolvedOptions.padding)
    if (!exportable) {
        throw new Error('Failed to build exportable svg')
    }

    const { width, height } = calcExportSize(
        exportable.contentWidth,
        exportable.contentHeight,
        resolvedOptions
    )
    if (width <= 0 || height <= 0) {
        throw new Error('Invalid export size')
    }

    exportable.svg.setAttribute('width', String(width))
    exportable.svg.setAttribute('height', String(height))

    const image = new Image()
    const source =
        'data:image/svg+xml;base64,' +
        btoa(unescape(encodeURIComponent(serializeSvg(exportable.svg))))
    await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Failed to load svg as image'))
        image.src = source
    })

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) {
        throw new Error('Failed to get canvas context')
    }

    context.fillStyle = resolvedOptions.backgroundColor
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    return canvas
}

export async function downloadPngElement(svgElement: SVGElement, fileName = DEFAULT_PNG_FILE_NAME) {
    try {
        const canvas = await exportSvgElementToCanvas(svgElement)
        const pngBlob = await canvasToBlob(canvas, PNG_MIME_TYPE)
        downloadBlob(pngBlob, fileName)
        return true
    } catch (error) {
        console.error('Download failed:', error)
        return false
    }
}
