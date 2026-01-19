import type { Point } from 'mermaid/dist/types.js'
import panzoom from 'svg-pan-zoom'
type PanZoom = typeof panzoom

interface IOptions {
    mouseWheelZoomEnabled?: boolean
    autoZoomOut?: boolean // 新增：是否自动缩小以避免工具栏重叠
}

export class PanZoomState {
    private pan?: Point
    private zoom?: number
    private pzoom: PanZoom | undefined
    private isDirty = false
    private lastError: unknown | null = null
    private resizeObserver: ResizeObserver
    private mouseWheelZoomEnabled: boolean
    private autoZoomOut: boolean // 新增：自动缩放配置

    public isPanEnabled: boolean
    public onPanZoomChange?: (pan: Point, zoom: number) => void
    /** 捕获 pan/zoom 相关错误（用于埋点/提示），不会主动触发 UI 更新 */
    public onPanZoomError?: (
        error: unknown,
        meta: { op: string; reason: 'nonInvertibleMatrix' | 'unknown' }
    ) => void

    constructor(option?: IOptions) {
        this.isPanEnabled = true
        this.resizeObserver = new ResizeObserver(() => {
            console.log('resize')
            this.resize()
            if (!this.isDirty) {
                this.reset()
            }
        })
        this.mouseWheelZoomEnabled = option?.mouseWheelZoomEnabled || false
        this.autoZoomOut = option?.autoZoomOut ?? false // 默认启用自动缩放
    }

    /** 识别已知的 svg-pan-zoom 矩阵不可逆错误（常见于 SVG 尺寸为 0 的瞬间） */
    private isNonInvertibleMatrixError(err: unknown): boolean {
        const message =
            typeof err === 'object' && err !== null && 'message' in err
                ? String((err as any).message || '')
                : String(err || '')
        // 浏览器/运行时可能略有差异，这里做宽松匹配
        return message.includes('SVGMatrix') && message.toLowerCase().includes('not invertible')
    }

    private handleFatalError(err: unknown, op: string) {
        this.lastError = err
        this.onPanZoomError?.(err, {
            op,
            reason: this.isNonInvertibleMatrixError(err) ? 'nonInvertibleMatrix' : 'unknown'
        })

        // 后退机制：销毁实例，避免后续事件/调用继续触发异常
        try {
            this.pzoom?.destroy()
        } catch {
            // ignore
        } finally {
            this.pzoom = undefined
        }
        this.isDirty = false
    }

    private safe(op: string, fn: () => void): boolean {
        try {
            fn()
            return true
        } catch (err) {
            // pan/zoom 属于增强能力，任何异常都不应放大到整页崩溃：兜底捕获并降级
            this.handleFatalError(err, op)
            return false
        }
    }

    public updateElement(diagramView: SVGElement, config?: { pan: Point; zoom: number }) {
        const { pan, zoom } = config || {}
        // 新元素初始化时清空上一次错误
        this.lastError = null
        this.safe('destroy', () => this.pzoom?.destroy())
        this.pzoom = undefined
        // let hammer: HammerManager | undefined;
        if (
            !this.safe('init', () => {
                this.pzoom = panzoom(diagramView, {
                    center: true,
                    fit: true,
                    panEnabled: true,
                    zoomEnabled: true,
                    controlIconsEnabled: false,
                    dblClickZoomEnabled: true,
                    preventMouseEventsDefault: true,
                    mouseWheelZoomEnabled: this.mouseWheelZoomEnabled,

                    maxZoom: 12,
                    minZoom: 0.2,
                    onPan: (pan) => {
                        this.pan = pan
                        if (!this.safe('onPan/getZoom', () => (this.zoom = this.pzoom?.getZoom())))
                            return
                        this.isDirty = true
                        if (this.zoom) {
                            this.onPanZoomChange?.(this.pan, this.zoom)
                        }
                    },
                    onZoom: (zoom) => {
                        this.zoom = zoom
                        if (!this.safe('onZoom/getPan', () => (this.pan = this.pzoom?.getPan())))
                            return
                        this.isDirty = true
                        if (this.pan) {
                            this.onPanZoomChange?.(this.pan, this.zoom)
                        }
                    }
                })
            })
        )
            return

        // this.resizeObserver.disconnect();
        // this.resizeObserver.observe(diagramView);

        if (
            pan &&
            zoom &&
            Number.isFinite(zoom) &&
            Number.isFinite(pan.x) &&
            Number.isFinite(pan.y)
        ) {
            this.safe('restorePanZoom', () => this.restorePanZoom(pan, zoom))
        } else {
            // reset 可能在布局未稳定（宽高为 0）时触发矩阵不可逆错误
            if (!this.safe('reset', () => this.reset())) return
        }

        // we start out with both pan and zoom enabled so that the tool can auto position view refreshed
        // then set enable/disable pan based on state
        if (this.isPanEnabled) {
            this.safe('enablePan', () => this.pzoom?.enablePan())
            this.safe('enableZoom', () => this.pzoom?.enableZoom())
        } else {
            this.safe('disableZoom', () => this.pzoom?.disableZoom())
            this.safe('disablePan', () => this.pzoom?.disablePan())
        }

        if (pan === undefined && zoom === undefined) {
            this.safe('reset', () => this.reset())
        }
    }

    public restorePanZoom(pan: Point, zoom: number) {
        if (!this.pzoom) {
            console.error('PanZoomState.restorePanZoom: pzoom is not initialized')
            return
        }
        if (!this.safe('zoom', () => this.pzoom?.zoom(zoom))) return
        this.safe('pan', () => this.pzoom?.pan(pan))
    }

    public resize() {
        this.safe('resize', () => this.pzoom?.resize())
        if (!this.isDirty) {
            this.safe('reset', () => this.reset())
        }
    }

    public zoomIn() {
        this.safe('zoomIn', () => this.pzoom?.zoomIn())
    }

    public zoomOut() {
        this.safe('zoomOut', () => this.pzoom?.zoomOut())
    }

    public fit() {
        this.safe('fit', () => this.pzoom?.fit())
    }

    public reset() {
        this.safe('resetInternal', () => this.pzoom?.reset())
        // 根据配置决定是否自动缩放以避免工具栏重叠
        if (this.autoZoomOut) {
            this.safe('autoZoomOut', () => this.pzoom?.zoom(0.875))
        }
        this.isDirty = false
    }

    public getSizes() {
        return this.pzoom?.getSizes()
    }

    /** 最近一次捕获到的 pan/zoom 错误（仅用于调试/上报） */
    public getLastError() {
        return this.lastError
    }
}
