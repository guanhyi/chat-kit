import { ExtraProps } from 'hast-util-to-jsx-runtime'
import { useContext, useEffect, useRef } from 'react'
import GraphContext from '../context'

type SvgProps = React.SVGProps<SVGSVGElement> &
    ExtraProps & {
        noRest?: boolean
    }

const Svg: React.FC<SvgProps> = (props) => {
    const { style, noRest, ...rest } = props

    const { isComplete, panZoomState, svgHeight } = useContext(GraphContext)

    const svgRef = useRef<SVGSVGElement | null>(null)

    useEffect(() => {
        let unmounted = false
        if (isComplete) {
            requestAnimationFrame(() => {
                if (unmounted) return
                const svgElement = svgRef.current
                if (!svgElement) return
                panZoomState.updateElement(svgElement)
            })
        }
        return () => {
            unmounted = true
            !noRest && panZoomState.reset()
        }
    }, [isComplete, noRest, panZoomState])

    return (
        <svg
            {...rest}
            width="100%"
            height={svgHeight}
            style={{ ...style, maxWidth: '100%' }}
            ref={svgRef}
        />
    )
}

export default Svg
