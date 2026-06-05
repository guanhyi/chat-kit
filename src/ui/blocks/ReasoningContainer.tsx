import React from 'react'
import clsx from 'clsx'

/**
 * 统一的推理块容器。
 */
export const ReasoningContainer: React.FC<
    React.PropsWithChildren<{ className?: string; style?: React.CSSProperties }>
> = ({ children, className, style }) => {
    return (
        <div
            className={clsx('rounded-md', className)}
            style={{
                padding: '4px 0',
                ...(style || {})
            }}
        >
            {children}
        </div>
    )
}

export default ReasoningContainer
