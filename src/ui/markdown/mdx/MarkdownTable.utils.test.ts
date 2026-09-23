// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
    buildCsvTableText,
    buildMarkdownTableText,
    escapeCsvCell,
    readRowsFromTable
} from './MarkdownTable.utils'

describe('escapeCsvCell', () => {
    it('降级公式型单元格，避免表格软件当公式执行', () => {
        expect(escapeCsvCell('=1+1')).toBe("'=1+1")
        expect(escapeCsvCell('+86')).toBe("'+86")
        expect(escapeCsvCell('-1')).toBe("'-1")
        expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)")
        // 前导空格骗不过 Excel，照样要降级
        expect(escapeCsvCell('  =cmd|calc')).toBe("'  =cmd|calc")
    })

    it('普通内容原样返回', () => {
        expect(escapeCsvCell('首列冻结')).toBe('首列冻结')
        expect(escapeCsvCell('1-2')).toBe('1-2')
    })

    it('含引号、逗号、换行时按 CSV 规则加引号', () => {
        expect(escapeCsvCell('a,b')).toBe('"a,b"')
        expect(escapeCsvCell('说"好"')).toBe('"说""好"""')
        expect(escapeCsvCell('第一行\n第二行')).toBe('"第一行\n第二行"')
    })
})

describe('buildCsvTableText', () => {
    it('带 UTF-8 BOM 并用 CRLF 分行', () => {
        const csv = buildCsvTableText([
            ['方案', '优点'],
            ['首列冻结', '行标题常驻']
        ])
        expect(csv.startsWith('﻿')).toBe(true)
        expect(csv).toBe('﻿方案,优点\r\n首列冻结,行标题常驻')
    })
})

describe('buildMarkdownTableText', () => {
    it('补齐到最宽一行的列数', () => {
        expect(
            buildMarkdownTableText([
                ['a', 'b', 'c'],
                ['1']
            ])
        ).toBe('| a | b | c |\n| --- | --- | --- |\n| 1 |  |  |')
    })

    it('转义管道符，换行改成 <br> 以免撑破表格结构', () => {
        expect(buildMarkdownTableText([['a|b'], ['第一行\n第二行']])).toBe(
            '| a\\|b |\n| --- |\n| 第一行<br>第二行 |'
        )
    })

    it('空表返回空串', () => {
        expect(buildMarkdownTableText([])).toBe('')
    })
})

describe('readRowsFromTable', () => {
    it('按渲染结果读单元格文本，表头和表体一起读出来', () => {
        const host = document.createElement('div')
        host.innerHTML = `
            <table>
                <thead><tr><th>方案</th><th>优点</th></tr></thead>
                <tbody><tr><td> 首列冻结 </td><td><a href="#">行标题常驻</a></td></tr></tbody>
            </table>`
        const rows = readRowsFromTable(host.querySelector('table'))
        expect(rows).toEqual([
            ['方案', '优点'],
            ['首列冻结', '行标题常驻']
        ])
    })

    it('拿不到表格时返回空数组', () => {
        expect(readRowsFromTable(null)).toEqual([])
    })
})
