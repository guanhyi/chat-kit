const SAFE_FLOWCHART_HEADER = /^flowchart\s+(LR|RL|TB|TD|BT)$/i
const SAFE_NODE = /^\s*[A-Za-z][A-Za-z0-9_]{0,65}\["[^"\n]{1,120}"\]\s*$/
const SAFE_EDGE = /^\s*[A-Za-z][A-Za-z0-9_]{0,65}\s+-->\|"[^"\n]{1,32}"\|\s+[A-Za-z][A-Za-z0-9_]{0,65}\s*$/
const FORBIDDEN = /%%\{|\b(click|href|style|classDef|linkStyle)\b|<|javascript:|https?:\/\//i

/** 会议脑图只接受服务端约定的 flowchart、节点和带标签边。 */
export const validateSafeFlowchart = (code: string): string => {
    const normalized = code.replace(/\r\n/g, '\n').trim()
    if (!normalized || normalized.length > 20_000 || FORBIDDEN.test(normalized)) {
        throw new Error('会议脑图包含不安全或过长的 Mermaid 内容')
    }

    const lines = normalized.split('\n').filter((line) => line.trim())
    if (lines.length > 201 || !SAFE_FLOWCHART_HEADER.test(lines[0])) {
        throw new Error('会议脑图仅支持安全 flowchart')
    }
    if (lines.slice(1).some((line) => !SAFE_NODE.test(line) && !SAFE_EDGE.test(line))) {
        throw new Error('会议脑图包含未允许的 Mermaid 指令')
    }
    return lines.join('\n')
}

export const resolveMermaidNodeId = (elementId: string, nodeIds: readonly string[]) => {
    return [...nodeIds]
        .sort((left, right) => right.length - left.length)
        .find((nodeId) => {
            const renderedId = `n_${nodeId.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64) || 'node'}`
            return elementId === nodeId
                || elementId.includes(`-${nodeId}-`)
                || elementId === renderedId
                || elementId.includes(`-${renderedId}-`)
        })
}
