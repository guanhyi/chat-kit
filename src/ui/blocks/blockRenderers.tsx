import type React from 'react'
import type { Block } from '../../types'
import { CitationBlock } from './CitationBlock'
import { MainTextBlock } from './MainTextBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolBlock } from './ToolBlock'

export interface BlockRenderContext {
    citations?: any[]
    showReferences?: boolean
    citationRender?: React.ComponentProps<typeof MainTextBlock>['citationRender']
}

export type BlockRenderer = (block: Block, context: BlockRenderContext) => React.ReactNode

const toRenderStatus = (status: string | undefined): 'streaming' | 'success' =>
    status === 'streaming' ? 'streaming' : 'success'

export const defaultBlockRenderers: Record<string, BlockRenderer> = {
    thinking: (block) => (
        <ThinkingBlock
            key={block.id}
            content={block.content || ''}
            status={toRenderStatus(block.status)}
        />
    ),
    tool: (block) => (
        <ToolBlock
            key={block.id}
            toolName={block.toolName || ''}
            content={block.content || ''}
            status={toRenderStatus(block.status)}
        />
    ),
    citation: (block, context) => (
        <CitationBlock
            key={block.id}
            docs={block.docs?.length ? block.docs : context.citations || []}
            showReferences={context.showReferences}
        />
    ),
    mainText: (block, context) => (
        <MainTextBlock
            key={block.id}
            content={block.content || ''}
            status={toRenderStatus(block.status)}
            citations={context.citations}
            citationRender={context.citationRender}
        />
    )
}

export function renderChatBlock(
    block: Block,
    context: BlockRenderContext = {},
    renderers: Record<string, BlockRenderer> = defaultBlockRenderers
): React.ReactNode {
    const render = renderers[block.type]
    if (!render) return null
    return render(block, context)
}
