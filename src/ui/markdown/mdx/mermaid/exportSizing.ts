export type ExportCanvasOptions = {
    backgroundColor?: string
    padding?: number
    minLongSidePx?: number
    maxLongSidePx?: number
    maxTotalPixels?: number
}

type ExportLayoutBounds = {
    x: number
    y: number
    width: number
    height: number
}

export const calculateExportLayout = (
    bounds: ExportLayoutBounds,
    padding: number,
    title?: string
) => {
    const safeTitle = title?.trim().slice(0, 80) || ''
    const titleHeight = safeTitle ? 52 : 0
    const graphCenterX = bounds.x + bounds.width / 2
    const minimumTitleWidth = safeTitle ? safeTitle.length * 14 + padding * 2 : 0
    const width = Math.max(bounds.width + padding * 2, minimumTitleWidth)

    return {
        safeTitle,
        titleX: graphCenterX,
        titleY: bounds.y - padding - 14,
        x: graphCenterX - width / 2,
        y: bounds.y - padding - titleHeight,
        width,
        height: bounds.height + padding * 2 + titleHeight
    }
}

export const calcExportSize = (
    contentWidth: number,
    contentHeight: number,
    opts: Required<ExportCanvasOptions>
) => {
    const longSide = Math.max(contentWidth, contentHeight)
    if (!Number.isFinite(longSide) || longSide <= 0) {
        return { width: 0, height: 0 }
    }

    let scale = 1
    if (longSide < opts.minLongSidePx) scale = opts.minLongSidePx / longSide
    if (longSide * scale > opts.maxLongSidePx) scale = opts.maxLongSidePx / longSide

    const totalPixels = contentWidth * contentHeight * scale * scale
    if (Number.isFinite(totalPixels) && totalPixels > opts.maxTotalPixels) {
        const areaScale = Math.sqrt(opts.maxTotalPixels / (contentWidth * contentHeight))
        if (Number.isFinite(areaScale)) scale = Math.min(scale, areaScale)
    }

    if (!Number.isFinite(scale) || scale <= 0) scale = 1

    return {
        // 向下取整，确保浮点和像素取整不会反向突破总像素上限。
        width: Math.max(1, Math.floor(contentWidth * scale)),
        height: Math.max(1, Math.floor(contentHeight * scale))
    }
}
