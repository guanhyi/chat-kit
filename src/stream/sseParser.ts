/**
 * 增量解析 SSE 文本：
 * - 以空行分隔事件，同一事件里所有 `data:` 行拼接成一个 JSON 字符串；
 * - `\r\n` / `\r` 统一成 `\n`，跨 chunk 被拆开的 `\r\n` 不会被误判成空行；
 * - 流结束时调用 flush，最后一个没以空行收尾的事件也会被解析出来。
 */
export class SseJsonParser {
    private buffer = ''
    private pendingCarriageReturn = false

    constructor(
        private readonly onInvalidJson?: (text: string, error: unknown) => void
    ) {}

    /** 追加一段文本，返回其中已完整的事件（已 JSON.parse） */
    push(chunk: string): unknown[] {
        if (!chunk) return []
        let text = chunk
        if (this.pendingCarriageReturn) {
            text = '\r' + text
            this.pendingCarriageReturn = false
        }
        // 末尾单独的 \r 可能是被拆开的 \r\n，留到下一段再归一化
        if (text.endsWith('\r')) {
            text = text.slice(0, -1)
            this.pendingCarriageReturn = true
        }
        this.buffer += text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        return this.drain()
    }

    /** 流结束：把剩余内容当作最后一个事件解析 */
    flush(): unknown[] {
        if (this.pendingCarriageReturn) {
            this.buffer += '\n'
            this.pendingCarriageReturn = false
        }
        const rest = this.buffer
        this.buffer = ''
        const parsed = this.parseEvent(rest)
        return parsed === undefined ? [] : [parsed]
    }

    private drain(): unknown[] {
        const result: unknown[] = []
        let boundary: number
        while ((boundary = this.buffer.indexOf('\n\n')) >= 0) {
            const eventText = this.buffer.slice(0, boundary)
            this.buffer = this.buffer.slice(boundary + 2)
            const parsed = this.parseEvent(eventText)
            if (parsed !== undefined) result.push(parsed)
        }
        return result
    }

    private parseEvent(eventText: string): unknown {
        const dataLines: string[] = []
        for (const line of eventText.split('\n')) {
            if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trim())
            }
        }
        const data = dataLines.join('\n')
        if (!data) return undefined
        try {
            return JSON.parse(data)
        } catch (error) {
            // 非法 JSON 直接跳过，避免中断整个流
            this.onInvalidJson?.(data, error)
            return undefined
        }
    }
}
