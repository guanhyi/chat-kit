export const transformCitations = (rawContent: string, length: number = 0) => {
    if (length === 0) {
        // 当文档引用长度为 0 时，检查文字中是否包含 [引用:number] 的格式，有就去除
        const nullPattern = /\[引用:\d+\]/g
        return rawContent.replaceAll(nullPattern, '')
    }

    const idx = Array.from({ length })
        .fill('')
        .map((_, index) => index + 1)

    const pattern = new RegExp(`\\[引用:(${idx.join('|')})\\]`, 'g')

    return rawContent
        .replaceAll(pattern, (_match, id) => `[#citation-${id}](citation-${id})`)
        .replaceAll('][', '] [')
}

