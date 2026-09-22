import { describe, expect, it } from 'vitest'
import { splitMessageBlocks } from './splitMessageBlocks'
import type { Block } from '../../types'

const block = (id: string, type: string): Block =>
    ({
        id,
        type,
        status: 'success',
        createdAt: 1,
        updatedAt: 1
    }) as Block

describe('splitMessageBlocks', () => {
    it('keeps process blocks in arrival order and lifts only the last main text', () => {
        const blocks = [
            block('t1', 'thinking'),
            block('tool1', 'tool'),
            block('text1', 'mainText'),
            block('tool2', 'tool'),
            block('text2', 'mainText')
        ]
        const split = splitMessageBlocks(blocks)
        expect(split.leading.map((item) => item.id)).toEqual(['t1', 'tool1', 'text1', 'tool2'])
        expect(split.tailText?.id).toBe('text2')
    })

    it('returns every block as leading when there is no main text', () => {
        const blocks = [block('t1', 'thinking'), block('tool1', 'tool')]
        const split = splitMessageBlocks(blocks)
        expect(split.leading).toHaveLength(2)
        expect(split.tailText).toBeUndefined()
    })
})
