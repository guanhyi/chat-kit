/**
 * 工具名 → 中文展示名。
 *
 * 精确表按仓库里现有的词汇整理（后端工作流节点 understand/search/organize/generate）；
 * 表里没有的走包含式规则，再兜底显示后端原始名。
 * 后端工具清单以后扩了，往 TOOL_DISPLAY_NAMES 里加一行即可，不用改调用方。
 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
    understand: '理解问题',
    search: '搜索',
    organize: '整理',
    generate: '生成'
}

const TOOL_DISPLAY_RULES: Array<{ pattern: RegExp; label: string }> = [
    // 「知识库检索」比「搜索」更具体，所以 kb_search 这类先命中这一条
    { pattern: /knowledge|kb|知识库/i, label: '知识库检索' },
    { pattern: /search|检索|搜索/i, label: '搜索' }
]

/**
 * 取工具名的中文展示名；名字为空时返回空串，由调用方决定用哪句通用文案。
 */
export const getToolDisplayName = (toolName?: string): string => {
    const raw = toolName?.trim()
    if (!raw) return ''

    return (
        TOOL_DISPLAY_NAMES[raw.toLowerCase()] ??
        TOOL_DISPLAY_RULES.find((rule) => rule.pattern.test(raw))?.label ??
        raw
    )
}
