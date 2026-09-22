import type { Block } from '../../types'

export interface SplitMessageBlocks {
    /** 最后一段正文之前的块，保持到达顺序 */
    leading: Block[]
    /** 轮尾正文。流式中的正文段就是这一段 */
    tailText?: Block
}

/**
 * 过程块和更早的正文留在原位，只把最后一段 mainText 抽到轮尾。
 * 不要按 updatedAt 重排：流式 delta 会刷新时间，一排就把交错顺序打乱。
 */
export function splitMessageBlocks(blocks: readonly Block[]): SplitMessageBlocks {
    let tailIndex = -1
    for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i]?.type === 'mainText') {
            tailIndex = i
            break
        }
    }
    if (tailIndex < 0) {
        return { leading: blocks.slice() }
    }
    return {
        leading: blocks.slice(0, tailIndex),
        tailText: blocks[tailIndex]
    }
}
