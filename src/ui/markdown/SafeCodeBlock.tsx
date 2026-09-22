import React from 'react'
import clsx from 'clsx'

interface SafeCodeBlockProps {
    className?: string
    children?: React.ReactNode
}

interface SafeCodeBlockState {
    failed: boolean
}

function readCodeText(children: React.ReactNode): string {
    return React.Children.toArray(children)
        .map((child) => {
            if (typeof child === 'string' || typeof child === 'number') return String(child)
            if (React.isValidElement(child)) {
                return readCodeText((child.props as { children?: React.ReactNode }).children)
            }
            return ''
        })
        .join('')
}

/**
 * 代码块高亮失败时固定显示原文，不再在高亮结果和原文之间来回切换。
 */
export class SafeCodeBlock extends React.Component<SafeCodeBlockProps, SafeCodeBlockState> {
    state: SafeCodeBlockState = { failed: false }

    static getDerivedStateFromError(): SafeCodeBlockState {
        return { failed: true }
    }

    render() {
        const text = readCodeText(this.props.children)
        if (this.state.failed) {
            return (
                <div className="chat-code-scroll my-[1.25em] max-w-full min-w-0 overflow-x-auto overscroll-x-contain rounded">
                    <pre className="!my-0 w-max max-w-none whitespace-pre break-normal">
                        <code>{text}</code>
                    </pre>
                </div>
            )
        }
        return (
            <div className="chat-code-scroll my-[1.25em] max-w-full min-w-0 overflow-x-auto overscroll-x-contain rounded">
                <pre
                    className={clsx(
                        '!my-0 w-max max-w-none whitespace-pre break-normal',
                        this.props.className
                    )}
                >
                    {this.props.children}
                </pre>
            </div>
        )
    }
}
