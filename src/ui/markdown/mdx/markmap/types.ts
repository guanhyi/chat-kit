import type { IMarkmapJSONOptions } from 'markmap-view'

export interface MarkmapBlockProps {
    code: string
    isComplete?: boolean
    jsonOptions?: Partial<IMarkmapJSONOptions>
}

export type MarkmapViewMode = 'chart' | 'code'

export interface RenderMarkmapRef {
    collapseToLevel: (level: number) => Promise<void>
    downloadPng: () => Promise<boolean>
    expandAll: () => Promise<void>
    fit: () => Promise<void>
    zoomIn: () => Promise<void>
    zoomOut: () => Promise<void>
}
