import React from 'react'
import { Popover, Typography } from '@douyinfe/semi-ui'
import { describe, expect, it, vi } from 'vitest'
import { MainTextBlock, defaultCitationRender } from './MainTextBlock'

vi.mock('@douyinfe/semi-ui', () => ({
    Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Typography: {
        Text: ({ children, ...props }: { children: React.ReactNode }) => (
            <span {...props}>{children}</span>
        )
    }
}))

vi.mock('../markdown/MarkdownRenderer', () => ({
    MarkdownRenderer: (props: unknown) => <div {...(props as Record<string, unknown>)} />
}))

describe('MainTextBlock', () => {
    it('uses the default citation renderer when none is provided', () => {
        const element = MainTextBlock({
            content: 'hello',
            citations: [{ title: 'Source title', url: 'https://example.com' }]
        }) as React.ReactElement<{ citationRender?: unknown }>

        expect(element.props.citationRender).toBe(defaultCitationRender)
    })

    it('keeps the custom citation renderer when one is provided', () => {
        const customCitationRender = () => <span>custom</span>
        const element = MainTextBlock({
            content: 'hello',
            citationRender: customCitationRender
        }) as React.ReactElement<{ citationRender?: unknown }>

        expect(element.props.citationRender).toBe(customCitationRender)
    })
})

describe('defaultCitationRender', () => {
    it('renders the citation number inline with detail content', () => {
        const element = defaultCitationRender({
            id: '2',
            citationDetail: {
                title: 'Source title',
                url: 'https://example.com'
            }
        }) as React.ReactElement<{
            content?: unknown
            children?: React.ReactElement
        }>

        const trigger = element.props.children as React.ReactElement<{
            style?: React.CSSProperties
            children?: React.ReactNode
        }>

        expect(element.type).toBe(Popover)
        expect(trigger.type).toBe(Typography.Text)
        expect(trigger.props.style?.marginInline).toBe('0.25em')
        expect(trigger.props.style?.lineHeight).toBe('inherit')
        expect(trigger.props.children).toBe('2')
        expect(element.props.content).toBeTruthy()
    })
})
