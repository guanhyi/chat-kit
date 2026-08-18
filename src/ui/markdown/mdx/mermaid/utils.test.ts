import { describe, expect, it } from 'vitest'

import { calculateExportLayout, calcExportSize } from './exportSizing'
import {
    MINDMAP_DOWNLOAD_FORMATS,
    MINDMAP_DOWNLOAD_LABEL,
    mindmapDownloadFailureMessage
} from './downloadPolicy'

const EXPORT_OPTIONS = {
    backgroundColor: '#fff',
    padding: 16,
    minLongSidePx: 4096,
    maxLongSidePx: 8192,
    maxTotalPixels: 25_000_000
}

describe('meeting mind-map PNG export', () => {
    it('reserves image space for the meeting title and full graph bounds', () => {
        const layout = calculateExportLayout({ x: 10, y: 20, width: 600, height: 400 }, 16, '产品评审会')
        expect(layout.safeTitle).toBe('产品评审会')
        expect(layout.height).toBe(484)
        expect(layout.width).toBeGreaterThanOrEqual(632)
    })

    it('scales an oversized graph as a whole under both limits', () => {
        const result = calcExportSize(20_000, 10_000, EXPORT_OPTIONS)
        expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(8192)
        expect(result.width * result.height).toBeLessThanOrEqual(25_000_000)
        expect(result.width / result.height).toBeCloseTo(2, 1)
    })

    it('offers PNG and no other export format', () => {
        expect(MINDMAP_DOWNLOAD_FORMATS).toEqual(['png'])
        expect(MINDMAP_DOWNLOAD_LABEL).toBe('下载 PNG')
    })

    it('returns an explicit user-facing message when PNG generation fails', () => {
        expect(mindmapDownloadFailureMessage(false)).toBe('PNG 生成失败，请稍后重试')
        expect(mindmapDownloadFailureMessage(true)).toBeNull()
    })
})
