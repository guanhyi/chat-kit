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

function svgToPng(
    svgElement: SVGElement,
    width: number,
    height: number,
    callback: (pngData: string) => void
): void {
    // 创建一个Canvas元素
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')

    // 检查ctx是否为null
    if (!ctx) {
        throw new Error('Failed to get canvas context')
    }

    // 将SVG转换为数据URL
    const svgData = new XMLSerializer().serializeToString(svgElement)
    const img = new Image()

    img.onload = function () {
        // 在Canvas上绘制图像
        ctx.drawImage(img, 0, 0)

        // 将Canvas转换为PNG数据URL
        const pngData = canvas.toDataURL('image/png')

        // 执行回调函数
        callback(pngData)
    }

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
}

const downloadPng = async (data: { id: string; width: number; height: number }) => {
    const { id, width, height } = data
    const svgElement = document.querySelector(id) as SVGElement
    if (!svgElement) {
        return false
    }
    return new Promise((resolve: (value: boolean) => void) => {
        svgToPng(svgElement, width, height, function (pngData) {
            // 创建一个新的图片元素显示PNG
            const img = new Image()
            img.src = pngData

            // 或者下载PNG
            const link = document.createElement('a')
            link.download = 'image.png'
            link.href = pngData
            link.click()
            resolve(true)
        })
    })
}

async function svgToPngAndCopy(data: { id: string; width: number; height: number }) {
    const { id, width, height } = data
    const svgElement = document.querySelector(id) as SVGElement
    if (!svgElement) {
        return false
    }
    try {
        // 1. 创建Canvas并设置尺寸
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')

        if (!ctx) {
            throw new Error('Failed to get canvas context')
        }

        // 2. 将SVG序列化为字符串
        const svgData = new XMLSerializer().serializeToString(svgElement)
        const img = new Image()

        // 3. 等待图片加载
        await new Promise((resolve, reject) => {
            img.onload = resolve
            img.onerror = reject
            img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
        })

        // 4. 在Canvas上绘制图像
        ctx.drawImage(img, 0, 0)

        // 5. 将Canvas转换为Blob
        const pngBlob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/png')
        })

        // 6. 复制到剪贴板
        await navigator.clipboard.write([
            new ClipboardItem({
                'image/png': pngBlob as Blob
            })
        ])
        return true
    } catch (error) {
        console.error('copy failed:', error)
        return false
    }
}

export { downloadPng, svgToPngAndCopy }

export { getMermaidId, parseSvgToJsx }
