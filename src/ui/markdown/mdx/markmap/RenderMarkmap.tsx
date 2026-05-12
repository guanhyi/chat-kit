import { CSSProperties, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { IMarkmapJSONOptions, Markmap } from 'markmap-view'
import { downloadPngElement } from './export'
import { getMarkmapModules, loadMarkmapAssets } from './moduleLoader'
import type { RenderMarkmapRef } from './types'

const DEFAULT_HEIGHT_PX = 560
const ZOOM_STEP = 1.2
const DEFAULT_JSON_OPTIONS: Partial<IMarkmapJSONOptions> = {
    zoom: true,
    pan: true
}

interface RenderMarkmapProps {
    code: string
    isComplete: boolean
    jsonOptions?: Partial<IMarkmapJSONOptions>
    height?: CSSProperties['height']
    width?: CSSProperties['width']
    frameless?: boolean
}

type MarkmapNode = NonNullable<Markmap['state']['data']>

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Markmap 渲染失败'
}

function buildMarkmapOptions(
    deriveOptions: typeof import('markmap-view').deriveOptions,
    frontmatterOptions?: Partial<IMarkmapJSONOptions>,
    jsonOptions?: Partial<IMarkmapJSONOptions>
) {
    const mergedOptions = {
        ...DEFAULT_JSON_OPTIONS,
        ...(frontmatterOptions || {}),
        ...(jsonOptions || {})
    }

    return {
        autoFit: true,
        embedGlobalCSS: true,
        ...deriveOptions(mergedOptions)
    }
}

function buildCanvasStyle(
    width?: CSSProperties['width'],
    height?: CSSProperties['height']
): CSSProperties {
    return {
        height: height ?? DEFAULT_HEIGHT_PX,
        width: width ?? '100%',
        maxWidth: '100%',
        minWidth: 0
    }
}

function updateFoldState(node: MarkmapNode, level: number) {
    const hasChildren = !!node.children?.length

    node.payload = {
        ...node.payload,
        fold: hasChildren && node.state.depth >= level ? 1 : 0
    }

    node.children?.forEach((child) => {
        updateFoldState(child, level)
    })
}

function expandNodeTree(node: MarkmapNode) {
    node.payload = {
        ...node.payload,
        fold: 0
    }

    node.children?.forEach((child) => {
        expandNodeTree(child)
    })
}

const RenderMarkmap = forwardRef<RenderMarkmapRef, RenderMarkmapProps>(
    ({ code, isComplete, jsonOptions, width, height, frameless = false }, ref) => {
        const svgRef = useRef<SVGSVGElement | null>(null)
        const markmapRef = useRef<Markmap | null>(null)
        const [errorText, setErrorText] = useState('')
        const [isLoading, setIsLoading] = useState(false)

        const teardown = useCallback(() => {
            markmapRef.current?.destroy()
            markmapRef.current = null
        }, [])

        const zoomBy = useCallback(async (ratio: number) => {
            const markmap = markmapRef.current
            if (!markmap) return

            const transition = markmap.transition(markmap.svg)
            transition.call(markmap.zoom.scaleBy as any, ratio)
            await transition.end().catch(() => undefined)
        }, [])

        useImperativeHandle(
            ref,
            () => ({
                collapseToLevel: async (level: number) => {
                    const root = markmapRef.current?.state.data
                    if (!markmapRef.current || !root) return

                    updateFoldState(root, level)
                    await markmapRef.current.renderData()
                    await markmapRef.current.fit()
                },
                downloadPng: async () => {
                    if (svgRef.current) {
                        return downloadPngElement(svgRef.current)
                    }
                    return false
                },
                expandAll: async () => {
                    const root = markmapRef.current?.state.data
                    if (!markmapRef.current || !root) return

                    expandNodeTree(root)
                    await markmapRef.current.renderData()
                    await markmapRef.current.fit()
                },
                fit: async () => {
                    await markmapRef.current?.fit()
                },
                zoomIn: async () => {
                    await zoomBy(ZOOM_STEP)
                },
                zoomOut: async () => {
                    await zoomBy(1 / ZOOM_STEP)
                }
            }),
            [zoomBy]
        )

        useEffect(() => {
            return () => {
                teardown()
            }
        }, [teardown])

        useEffect(() => {
            if (!isComplete || !code.trim()) {
                setErrorText('')
                setIsLoading(false)
                teardown()
                return
            }

            let active = true

            const render = async () => {
                setIsLoading(true)
                setErrorText('')

                try {
                    const modules = await getMarkmapModules()
                    const transformed = modules.transformer.transform(code)
                    const assets = modules.transformer.getUsedAssets(transformed.features)
                    const options = buildMarkmapOptions(
                        modules.deriveOptions,
                        transformed.frontmatter?.markmap,
                        jsonOptions
                    )

                    await loadMarkmapAssets(modules, assets)
                    if (!active || !svgRef.current) return

                    const mm =
                        markmapRef.current ??
                        modules.Markmap.create(svgRef.current, options, transformed.root)

                    if (!markmapRef.current) {
                        markmapRef.current = mm
                    } else {
                        mm.setOptions(options)
                        await mm.setData(transformed.root)
                    }

                    if (!active || !markmapRef.current) return
                    await markmapRef.current.fit()
                } catch (error) {
                    if (!active) return
                    teardown()
                    setErrorText(getErrorMessage(error))
                } finally {
                    if (active) {
                        setIsLoading(false)
                    }
                }
            }

            void render()

            return () => {
                active = false
            }
        }, [code, isComplete, jsonOptions, teardown])

        return (
            <div
                className={
                    frameless
                        ? 'relative h-full w-full overflow-hidden bg-white'
                        : 'relative overflow-hidden rounded-md border border-neutral-200 bg-white'
                }
                style={buildCanvasStyle(width, height)}
            >
                <svg ref={svgRef} className="h-full w-full" />
                {!isComplete && (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-500">
                        Markmap 生成中…
                    </div>
                )}
                {isLoading && !errorText && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/85 text-sm text-neutral-500">
                        Markmap 渲染中…
                    </div>
                )}
                {!!errorText && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/95 px-4 text-sm text-red-500">
                        {errorText}
                    </div>
                )}
            </div>
        )
    }
)

export default RenderMarkmap
