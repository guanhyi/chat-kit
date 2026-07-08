import type { MermaidConfig } from 'mermaid'

export interface MermaidProps {
    /** Mermaid图表代码 */
    code: string
    /** 代码是否完整（是否有结束的```标记） */
    isComplete?: boolean
    /** 自定义mermaid配置 */
    mermaidConfig?: MermaidConfig
    /** 当前 Markdown 是否仍在流式输出 */
    streaming?: boolean
    node?: any
}

export interface MermaidState {
    isLoading: boolean
    hasError: boolean
    error?: Error
}
export interface RemarkMermaidCompletenessOptions {
    /** 是否启用完整性检测 */
    enabled?: boolean
}
