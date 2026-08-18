import type { MermaidConfig } from 'mermaid'

export interface MermaidProps {
    /** Mermaid图表代码 */
    code: string
    /** 代码是否完整（是否有结束的```标记） */
    isComplete?: boolean
    node?: any
    strictFlowchart?: boolean
    downloadFileName?: string
    downloadTitle?: string
    nodeIds?: readonly string[]
    onNodeClick?: (nodeId: string) => void
    onRenderError?: (message: string) => void
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
