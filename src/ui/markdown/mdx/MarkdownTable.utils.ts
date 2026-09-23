/**
 * 表格的纯数据逻辑：读取、导出、转义。
 * 与组件分开放，是为了让这部分不牵连 Semi / React，可以直接单测。
 */

export type MarkdownTableRows = string[][]

/**
 * CSV 单元格转义。
 *
 * assistant 的输出属于不可信内容，而 Excel / Numbers / LibreOffice 打开 CSV 时
 * 会把 `=` `+` `-` `@` 开头的单元格当公式执行，所以下载前统一降级成纯文本。
 */
export function escapeCsvCell(value: string): string {
    const safe = /^[\t\r\n]/.test(value) || /^\s*[=+\-@]/.test(value) ? `'${value}` : value
    if (!/[",\r\n]/.test(safe)) return safe
    return `"${safe.replace(/"/g, '""')}"`
}

export function buildCsvTableText(rows: MarkdownTableRows): string {
    const csv = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
    // Blob 的 charset 不会写进文件字节，Excel 会按本地代码页解析无 BOM 的 UTF-8，
    // 中文因此乱码，所以显式补一个 BOM。
    return `﻿${csv}`
}

function escapeMarkdownCell(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, '<br>')
}

/** 把表格数据拼回规范的 GFM 表格，列数按最宽的一行对齐补齐。 */
export function buildMarkdownTableText(rows: MarkdownTableRows): string {
    if (!rows.length) return ''

    const columnCount = Math.max(...rows.map((row) => row.length), 1)
    const normalized = rows.map((row) =>
        Array.from({ length: columnCount }, (_, i) => escapeMarkdownCell(row[i] ?? ''))
    )
    const [header = [], ...body] = normalized
    const separator = Array.from({ length: columnCount }, () => '---')

    return [header, separator, ...body].map((row) => `| ${row.join(' | ')} |`).join('\n')
}

/** 从渲染好的 DOM 读表格内容，比从 React children 里反推单元格文本可靠。 */
export function readRowsFromTable(table: HTMLTableElement | null): MarkdownTableRows {
    if (!table) return []

    return Array.from(table.rows).map((row) =>
        Array.from(row.cells).map((cell) => (cell.textContent || '').trim())
    )
}
