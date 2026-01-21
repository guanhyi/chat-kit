import React from 'react'
import { Sparkle } from 'lucide-react'
import { ReasoningContainer } from './ReasoningContainer'

export interface ReasoningHeaderProps {
    isThinking?: boolean
    searchLoading?: boolean
    loading?: boolean
    isEnd?: boolean
    className?: string
}

/**
 * 阶段提示头部（块模式）
 * - 复用 AIReasoning 的头部样式与文案
 * - 独立为一个块，便于插入在思考/工具/引用块之前
 */
export const ReasoningHeader: React.FC<ReasoningHeaderProps> = ({
    isThinking,
    searchLoading,
    loading,
    isEnd,
    className
}) => {
    // 只在“推理中”或“检索中”阶段展示旋转效果，避免因正文流式 loading 一直为 true 导致头部长期 loading
    const spinLoading = Boolean(!isEnd && (isThinking || searchLoading))
    void loading

    const text = isThinking || searchLoading ? '推理中...' : '已完成推理'

    return (
        <ReasoningContainer className={className}>
            <div className="flex items-center text-[14px]">
                <div className="size-7 flex justify-center items-center">
                    <Sparkle
                        data-loading={spinLoading}
                        className="text-purple-500 data-[loading=true]:animate-spin"
                        size={16}
                    />
                </div>
                <div className="font-[500] ml-[14px]">{text}</div>
            </div>
        </ReasoningContainer>
    )
}

export default ReasoningHeader

