import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Modal } from '@douyinfe/semi-ui'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import { Check, Copy, Download, Maximize2 } from 'lucide-react'
import {
    buildCsvTableText,
    buildMarkdownTableText,
    readRowsFromTable
} from './MarkdownTable.utils'

export * from './MarkdownTable.utils'

type EdgeShadowState = 'none' | 'left' | 'right' | 'both'

/**
 * 跟踪横向溢出状态，供左右边缘阴影使用。
 * 流式输出时表格会不断增行、表宽随之变化，所以除了 scroll 还要观察尺寸。
 */
function useEdgeShadowState(viewport: HTMLElement | null): EdgeShadowState {
    const [state, setState] = useState<EdgeShadowState>('none')

    useEffect(() => {
        if (!viewport) return

        const measure = () => {
            const max = viewport.scrollWidth - viewport.clientWidth
            // 1px 容差：页面缩放和小数宽度下 scrollWidth 经常比 clientWidth 大零点几
            if (max <= 1) {
                setState('none')
                return
            }
            const hasLeft = viewport.scrollLeft > 1
            const hasRight = viewport.scrollLeft < max - 1
            setState(hasLeft && hasRight ? 'both' : hasLeft ? 'left' : hasRight ? 'right' : 'none')
        }

        measure()
        viewport.addEventListener('scroll', measure, { passive: true })

        let observer: ResizeObserver | undefined
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(measure)
            observer.observe(viewport)
            const table = viewport.querySelector('table')
            if (table) observer.observe(table)
        }

        return () => {
            viewport.removeEventListener('scroll', measure)
            observer?.disconnect()
        }
    }, [viewport])

    return state
}

function EdgeShadow({ side, state }: { side: 'left' | 'right'; state: EdgeShadowState }) {
    if (state !== side && state !== 'both') return null

    return (
        <div
            aria-hidden="true"
            className={clsx(
                'pointer-events-none absolute inset-y-0 z-20 w-6',
                side === 'left'
                    ? 'hidden left-0 shadow-[inset_12px_0_12px_-12px_rgba(0,0,0,0.15)] md:block'
                    : 'right-0 shadow-[inset_-12px_0_12px_-12px_rgba(0,0,0,0.15)]'
            )}
        />
    )
}

function ToolbarButton({
    label,
    onClick,
    children
}: {
    label: string
    onClick: () => void
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
            {children}
        </button>
    )
}

/**
 * 表格骨架：滚动容器 + 圆角边框，内层 table 按内容撑开。
 *
 * 滚动交给 OverlayScrollbars，和 ChatBubbleList 用的是同一套——原生滚动条在
 * Windows 上是又宽又重的一条，压在表格底边上很显眼。
 */
function TableFrame({
    tableRef,
    className,
    children,
    tableClassName,
    scrollY,
    ...rest
}: {
    tableRef?: React.RefObject<HTMLTableElement>
    className?: string
    children?: React.ReactNode
    tableClassName?: string
    /** 纵向也在框内滚。预览弹窗用，表头 sticky 需要一个真的会滚的容器。 */
    scrollY?: boolean
} & React.ComponentProps<'table'>) {
    // OverlayScrollbars 的 viewport 是它自己建的，拿不到 ref，只能等初始化后接出来
    const [viewport, setViewport] = useState<HTMLElement | null>(null)
    const edgeShadow = useEdgeShadowState(viewport)

    return (
        <div className="relative w-full overflow-hidden rounded-xl border border-gray-200">
            <OverlayScrollbarsComponent
                defer
                className="w-full"
                style={scrollY ? { maxHeight: 'calc(100vh - 220px)' } : undefined}
                options={{
                    scrollbars: { visibility: 'auto', autoHide: 'leave', autoHideDelay: 200 },
                    overflow: { x: 'scroll', y: scrollY ? 'scroll' : 'hidden' }
                }}
                events={{
                    initialized: (instance) => setViewport(instance.elements().viewport)
                }}
            >
                <table
                    ref={tableRef}
                    // w-max + min-w-full：窄表格铺满气泡，宽表格按内容撑开后横向滚动。
                    // border-separate 是必需的：sticky 单元格在 border-collapse 下会丢边框；
                    // 它同时让 prose 加在 tr/thead 上的 border 失效（分隔线改由单元格自己画）。
                    // 这里的 ! 都是压 prose：.prose table 这类选择器特异性高于 utility，
                    // 不加的话 width:100% 会把表格压回容器宽度，各列一路缩到 min-width 下限。
                    className={clsx(
                        '!my-0 !w-max min-w-full border-separate border-spacing-0 !text-[13px] !leading-normal',
                        tableClassName,
                        className
                    )}
                    {...rest}
                >
                    {children}
                </table>
            </OverlayScrollbarsComponent>
            <EdgeShadow side="left" state={edgeShadow} />
            <EdgeShadow side="right" state={edgeShadow} />
        </div>
    )
}

export interface MarkdownTableProps extends React.ComponentProps<'table'> {
    node?: unknown
    /** 流式输出中。此时表格还在长，工具条先不给，避免复制/下载到半截数据。 */
    streaming?: boolean
}

/**
 * Markdown 表格：滚动容器与表格分离，配工具条、左右边缘阴影与全屏预览。
 *
 * 窄屏下首列冻结（见 MarkdownRenderer 里 th/td 的 sticky 规则），
 * 横滑时行标题常驻；桌面端列宽够用，不做冻结。
 */
export const MarkdownTable: React.FC<MarkdownTableProps> = ({
    node,
    className,
    children,
    streaming,
    ...rest
}) => {
    void node
    const tableRef = useRef<HTMLTableElement>(null)
    const [previewOpen, setPreviewOpen] = useState(false)
    const [copied, setCopied] = useState<'markdown' | 'csv' | null>(null)
    const copiedTimer = useRef<ReturnType<typeof setTimeout>>()

    useEffect(() => () => clearTimeout(copiedTimer.current), [])

    const copy = useCallback(async (kind: 'markdown' | 'csv', text: string) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(kind)
            clearTimeout(copiedTimer.current)
            copiedTimer.current = setTimeout(() => setCopied(null), 1600)
        } catch {
            // 非安全上下文或用户拒绝授权时拿不到剪贴板，静默放弃即可
        }
    }, [])

    const handleCopyMarkdown = useCallback(() => {
        void copy('markdown', buildMarkdownTableText(readRowsFromTable(tableRef.current)))
    }, [copy])

    const handleCopyCsv = useCallback(() => {
        void copy('csv', buildCsvTableText(readRowsFromTable(tableRef.current)))
    }, [copy])

    const handleDownloadCsv = useCallback(() => {
        const rows = readRowsFromTable(tableRef.current)
        if (!rows.length) return

        const blob = new Blob([buildCsvTableText(rows)], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = 'table.csv'
        link.click()
        URL.revokeObjectURL(url)
    }, [])

    return (
        <div className="my-[1.25em] flex min-w-0 flex-col gap-1.5">
            {streaming ? null : (
                <div className="flex items-center justify-end gap-0.5">
                    <ToolbarButton label="复制 Markdown" onClick={handleCopyMarkdown}>
                        {copied === 'markdown' ? <Check size={14} /> : <Copy size={14} />}
                    </ToolbarButton>
                    <ToolbarButton label="复制 CSV" onClick={handleCopyCsv}>
                        {copied === 'csv' ? (
                            <Check size={14} />
                        ) : (
                            <span className="text-[10px] font-medium leading-none">CSV</span>
                        )}
                    </ToolbarButton>
                    <ToolbarButton label="下载 CSV" onClick={handleDownloadCsv}>
                        <Download size={14} />
                    </ToolbarButton>
                    <ToolbarButton label="查看完整表格" onClick={() => setPreviewOpen(true)}>
                        <Maximize2 size={14} />
                    </ToolbarButton>
                </div>
            )}

            <TableFrame tableRef={tableRef} className={className} {...rest}>
                {children}
            </TableFrame>

            <Modal
                title="表格"
                visible={previewOpen}
                onCancel={() => setPreviewOpen(false)}
                footer={null}
                // 宽度跟着表格走：2 列的窄表不该被硬拉到固定宽度，宽表则顶到视口为止。
                // 左右留白由 Semi 的 modal-content（20px）负责，这里只补被 padding:0
                // 抹掉的底部留白，否则表格直接贴在弹窗底边上。
                width="fit-content"
                style={{
                    maxWidth: 'calc(100vw - 32px)',
                    minWidth: 'min(520px, calc(100vw - 32px))'
                }}
                bodyStyle={{ padding: '0 0 20px', overflow: 'hidden' }}
            >
                {/*
                  预览里横纵都能滚，表头和首列都值得钉住；对话流里表格跟着页面滚，
                  钉表头反而会错位，所以只在这里做。
                  这些 ! 是压单元格自己的 md:first:static —— 弹窗是 portal，
                  够不到外面的样式，只能在表格这一层把规则定死。
                */}
                <TableFrame
                    scrollY
                    tableClassName={clsx(
                        '[&_th]:!sticky [&_th]:!top-0 [&_th]:!z-20 [&_th]:!bg-gray-50',
                        '[&_th:first-child]:!left-0 [&_th:first-child]:!z-30',
                        '[&_td:first-child]:!sticky [&_td:first-child]:!left-0 [&_td:first-child]:!bg-white'
                    )}
                >
                    {children}
                </TableFrame>
            </Modal>
        </div>
    )
}

export const MarkdownTableHeaderCell: React.FC<React.ComponentProps<'th'> & { node?: unknown }> = ({
    node,
    className,
    ...rest
}) => {
    void node
    return (
        <th
            className={clsx(
                // ! 同样是压 prose：.prose thead th:first-child { padding-left: 0 } 之类
                // 会把首列内容顶到边上，sticky 首列尤其难看
                'border-b border-gray-200 bg-gray-50 !px-3 !py-2 text-left !align-bottom !font-medium text-gray-600',
                // 列宽上下限：不夹住的话，流式每增一行都可能推宽某列，整张表来回抖
                'min-w-16 max-w-[15rem] whitespace-normal break-words md:max-w-md',
                // 窄屏首列冻结，横滑时行标题常驻
                'first:sticky first:left-0 first:z-10 first:border-r md:first:static',
                'first:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] md:first:shadow-none',
                className
            )}
            {...rest}
        />
    )
}

export const MarkdownTableCell: React.FC<React.ComponentProps<'td'> & { node?: unknown }> = ({
    node,
    className,
    ...rest
}) => {
    void node
    return (
        <td
            className={clsx(
                'border-b border-gray-200 !px-3 !py-2 !align-top text-gray-800',
                'min-w-16 max-w-[15rem] whitespace-normal break-words md:max-w-md',
                'first:sticky first:left-0 first:z-10 first:border-r first:bg-white md:first:static',
                'first:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] md:first:shadow-none',
                className
            )}
            {...rest}
        />
    )
}

export default MarkdownTable
