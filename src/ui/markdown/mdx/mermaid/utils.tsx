import { unified } from 'unified'
import rehypeParse from 'rehype-parse'
import { Components, toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import Svg from './components/svg'

let _mermaidId = 0

const getMermaidId = () => {
    return `mermaid-${_mermaidId++}`
}

type ParseSvgToJsxOptions = {
    noRest?: boolean
}

function setSvgProp(hast: any, key: string, value: unknown): boolean {
    if (!hast || typeof hast !== 'object') return false
    const children = (hast as any).children
    if (!Array.isArray(children)) return false

    for (const child of children) {
        if (child?.type === 'element' && child?.tagName === 'svg') {
            child.properties = child.properties || {}
            child.properties[key] = value
            return true
        }
        if (setSvgProp(child, key, value)) return true
    }

    return false
}

const parseSvgToJsx = (svgString: string, options: ParseSvgToJsxOptions = {}) => {
    if (!svgString) return null
    try {
        const processor = unified().use(rehypeParse, { fragment: true, space: 'svg' })
        const hast = processor.parse(svgString)
        if (options.noRest) {
            setSvgProp(hast, 'noRest', true)
        }
        const jsxElement = toJsxRuntime(hast, {
            Fragment,
            jsx,
            jsxs,
            passKeys: true, // 保留所有属性
            // mermaid 生成的 SVG 可能包含不完整/不兼容的内联 style，避免因此导致整张图渲染失败
            ignoreInvalidStyle: true,
            components: {
                svg: Svg
            } as Components
        })
        return jsxElement
    } catch (err) {
        console.error('Failed to parse SVG to JSX:', err)
        return null
    }
}

export { getMermaidId, parseSvgToJsx }
