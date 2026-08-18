import { describe, expect, it } from 'vitest'

import { resolveMermaidNodeId, validateSafeFlowchart } from './security'

describe('meeting mind-map Mermaid security', () => {
    it('accepts only the controlled flowchart grammar', () => {
        const code = 'flowchart LR\n  root["会议"]\n  n_topic_1["方案"]\n  root -->|"包含议题"| n_topic_1'
        expect(validateSafeFlowchart(code)).toBe(code)
    })

    it.each([
        'flowchart LR\n  A["x"]\n  click A "javascript:alert(1)"',
        '%%{init: {"securityLevel": "loose"}}%%\nflowchart LR',
        'flowchart LR\n  A["<script>alert(1)</script>"]',
        'sequenceDiagram\n  A->>B: hello',
        'flowchart LR\n  A["x"]\n  style A fill:red'
    ])('rejects unsafe or unsupported input', (code) => {
        expect(() => validateSafeFlowchart(code)).toThrow()
    })

    it('maps Mermaid sanitized IDs back to structured node IDs', () => {
        expect(resolveMermaidNodeId('flowchart-n_topic_1-0', ['topic-1'])).toBe('topic-1')
    })
})
