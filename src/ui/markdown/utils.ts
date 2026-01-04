export const transformCitations = (rawContent: string, length: number = 0) => {
    if (!rawContent) return rawContent

    if (length === 0) {
        // 当文档引用长度为 0 时，检查文字中是否包含 [引用:number] 的格式，有就去除
        // 同时处理常见的 Markdown 包裹（如 `...`、**...**），避免只删除内容后留下空壳语法导致解析异常
        const inlineCodePattern = /(`+)\s*\\?\[引用:\d+\\?\]\s*\1/g
        const strongAsteriskPattern = /\*\*\s*\\?\[引用:\d+\\?\]\s*\*\*/g
        const strongUnderscorePattern = /__\s*\\?\[引用:\d+\\?\]\s*__/g
        const strikePattern = /~~\s*\\?\[引用:\d+\\?\]\s*~~/g
        const emAsteriskPattern = /\*\s*\\?\[引用:\d+\\?\]\s*\*/g
        const emUnderscorePattern = /_\s*\\?\[引用:\d+\\?\]\s*_/g
        const nullPattern = /\\?\[引用:\d+\\?\]/g

        return rawContent
            .replaceAll(inlineCodePattern, '')
            .replaceAll(strongAsteriskPattern, '')
            .replaceAll(strongUnderscorePattern, '')
            .replaceAll(strikePattern, '')
            .replaceAll(emAsteriskPattern, '')
            .replaceAll(emUnderscorePattern, '')
            .replaceAll(nullPattern, '')
    }

    const idx = Array.from({ length }, (_, index) => index + 1)
    const idxPart = idx.join('|')

    // 1) 处理行内代码包裹的引用：`[引用:1]` -> [#citation-1](citation-1)
    //    这里会把外层 `...` 去掉，否则 Markdown 不会在 code span 内解析链接
    const inlineCodePattern = new RegExp(
        '(`+)\\s*\\\\?\\[引用:(' + idxPart + ')\\\\?\\]\\s*\\1',
        'g'
    )

    // 2) 常规引用：支持可选的转义写法 \[引用:1\]
    const pattern = new RegExp('\\\\?\\[引用:(' + idxPart + ')\\\\?\\]', 'g')

    return rawContent
        .replaceAll(inlineCodePattern, (_match, _ticks, id) => `[#citation-${id}](citation-${id})`)
        .replaceAll(pattern, (_match, id) => `[#citation-${id}](citation-${id})`)
        .replaceAll('][', '] [')
}
