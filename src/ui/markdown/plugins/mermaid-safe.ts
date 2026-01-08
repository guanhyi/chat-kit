import rehypeMermaid, { type RehypeMermaidOptions } from 'rehype-mermaid'

export type RehypeMermaidSafeOptions = RehypeMermaidOptions & {
    /**
     * Mermaid 渲染失败时是否保留原始代码块（默认保留）。
     *
     * - `true`: 保留原始 `<pre><code class="language-mermaid">...`
     * - `false`: 交由 `rehype-mermaid` 默认行为（会抛错或被移除，取决于其实现）
     */
    keepCodeOnError?: boolean
}

/**
 * rehype 插件：对 `rehype-mermaid` 做一层兜底。
 *
 * 背景：`rehype-mermaid` 默认策略会异步渲染（返回 Promise），且在 mermaid 语法不完整/不合法时可能抛错。
 * 在流式场景或用户写错图表语法时，我们更希望“不渲染图表但保留代码块”，而不是直接让整段 Markdown 渲染失败。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const rehypeMermaidSafe = function (this: any, options?: RehypeMermaidSafeOptions) {
    const { keepCodeOnError = true, errorFallback: userFallback, ...rest } = options ?? {}

    return (rehypeMermaid as any).call(this, {
        ...rest,
        errorFallback: (element: any, diagram: string, error: unknown, file: any) => {
            const result = userFallback?.(element, diagram, error, file)
            if (result !== undefined) return result
            if (!keepCodeOnError) return
            return element
        }
    })
} as any

export default rehypeMermaidSafe
