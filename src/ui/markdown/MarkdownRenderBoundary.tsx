import React from 'react'

interface MarkdownRenderBoundaryProps {
    resetKey: string
    fallbackText: string
    className?: string
    children: React.ReactNode
}

interface MarkdownRenderBoundaryState {
    error: Error | null
}

/**
 * Markdown 解析或代码高亮抛错时，整段降级为纯文本，避免把气泡打白。
 * resetKey 变化后重试解析，流式增量不会被一次失败永久锁死。
 */
export class MarkdownRenderBoundary extends React.Component<
    MarkdownRenderBoundaryProps,
    MarkdownRenderBoundaryState
> {
    state: MarkdownRenderBoundaryState = { error: null }

    static getDerivedStateFromError(error: unknown): MarkdownRenderBoundaryState {
        return { error: error instanceof Error ? error : new Error(String(error)) }
    }

    componentDidUpdate(previous: MarkdownRenderBoundaryProps) {
        if (this.state.error && previous.resetKey !== this.props.resetKey) {
            this.setState({ error: null })
        }
    }

    render() {
        if (this.state.error) {
            return (
                <div className={this.props.className} style={{ whiteSpace: 'pre-wrap' }}>
                    {this.props.fallbackText}
                </div>
            )
        }
        return this.props.children
    }
}
