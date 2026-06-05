type CitationSource = number | Array<unknown> | null | undefined

const getValidCitationIds = (source: CitationSource) => {
    const ids = new Set<number>()

    if (typeof source === 'number') {
        const length = Math.max(0, Math.floor(source))
        for (let index = 1; index <= length; index++) {
            ids.add(index)
        }
        return ids
    }

    if (Array.isArray(source)) {
        source.forEach((item, index) => {
            if (item != null) {
                ids.add(index + 1)
            }
        })
    }

    return ids
}

const removeInvalidCitationMarkers = (source: string, validIds: Set<number>) => {
    let result = source

    const replaceCitationOnlyWrapper = (pattern: RegExp, idGroupIndex: number) => {
        result = result.replaceAll(pattern, (...args) => {
            const id = Number(args[idGroupIndex])
            return validIds.has(id) ? args[0] : ''
        })
    }

    // 先处理仅包裹引用的 Markdown 语法，避免删掉引用后留下 **、` 等空壳。
    replaceCitationOnlyWrapper(/(`+)\s*\\?\[引用:(\d+)\\?\]\s*\1/g, 2)
    replaceCitationOnlyWrapper(/\*\*\s*\\?\[引用:(\d+)\\?\]\s*\*\*/g, 1)
    replaceCitationOnlyWrapper(/__\s*\\?\[引用:(\d+)\\?\]\s*__/g, 1)
    replaceCitationOnlyWrapper(/~~\s*\\?\[引用:(\d+)\\?\]\s*~~/g, 1)
    replaceCitationOnlyWrapper(/\*\s*\\?\[引用:(\d+)\\?\]\s*\*/g, 1)
    replaceCitationOnlyWrapper(/_\s*\\?\[引用:(\d+)\\?\]\s*_/g, 1)

    return result.replaceAll(/\\?\[引用:(\d+)\\?\]/g, (match, id) => {
        return validIds.has(Number(id)) ? match : ''
    })
}

export const transformCitations = (rawContent: string, citations: CitationSource = 0) => {
    if (!rawContent) return rawContent

    const validIds = getValidCitationIds(citations)
    const content = removeInvalidCitationMarkers(rawContent, validIds)

    if (validIds.size === 0) {
        return content
    }

    const idx = Array.from(validIds).sort((left, right) => left - right)
    const idxPart = idx.join('|')

    // 1) 处理行内代码包裹的引用：`[引用:1]` -> [#citation-1](citation-1)
    //    这里会把外层 `...` 去掉，否则 Markdown 不会在 code span 内解析链接
    const inlineCodePattern = new RegExp(
        '(`+)\\s*\\\\?\\[引用:(' + idxPart + ')\\\\?\\]\\s*\\1',
        'g'
    )

    // 2) 常规引用：支持可选的转义写法 \[引用:1\]
    const pattern = new RegExp('\\\\?\\[引用:(' + idxPart + ')\\\\?\\]', 'g')

    const transformed = content
        .replaceAll(inlineCodePattern, (_match, _ticks, id) => `[#citation-${id}](citation-${id})`)
        .replaceAll(pattern, (_match, id) => `[#citation-${id}](citation-${id})`)
        .replaceAll('][', '] [')

    // 3) GFM 会把 `https://...` / `www....` 自动识别成链接（autolink literal）。
    //    若 citation 紧贴在 URL 后（无空格），会导致 `[#citation-x` 被吞进 URL，尾部残留 `](citation-x)`。
    //    这里补一个空格打断 autolink。
    return transformed
        .replaceAll(
            /(https?:\/\/[^\s\[]+)\[#citation-(\d+)\]\(citation-\2\)/g,
            '$1 [#citation-$2](citation-$2)'
        )
        .replaceAll(
            /(www\.[^\s\[]+)\[#citation-(\d+)\]\(citation-\2\)/g,
            '$1 [#citation-$2](citation-$2)'
        )
}
