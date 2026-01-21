import React from 'react'
import clsx from 'clsx'

/**
 * 统一的“AI 推理蓝色背景”容器
 * 用于块模式下每个块的底色，复用 AIReasoning 的渐变背景与内边距。
 */
export const ReasoningContainer: React.FC<
    React.PropsWithChildren<{ className?: string; style?: React.CSSProperties }>
> = ({ children, className, style }) => {
    return (
        <div
            className={clsx('rounded-lg', className)}
            style={{
                padding: '10px 16px',
                background:
                    'linear-gradient(0deg, #f3f5fc, #f3f5fc), linear-gradient(196.75deg, rgba(248, 250, 255, 0.7) 38.16%, rgba(243, 245, 252, 0.7) 96.85%)',
                ...(style || {})
            }}
        >
            {children}
        </div>
    )
}

export default ReasoningContainer

