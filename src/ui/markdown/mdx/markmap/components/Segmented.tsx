import { Radio, RadioGroup } from '@douyinfe/semi-ui'
import type { MarkmapViewMode } from '../types'

export interface MarkmapSegmentedProps {
    value: MarkmapViewMode
    onChange: (value: MarkmapViewMode) => void
}

const MarkmapSegmented: React.FC<MarkmapSegmentedProps> = ({ value, onChange }) => {
    return (
        <RadioGroup
            type="button"
            buttonSize="middle"
            defaultValue={value}
            value={value}
            onChange={(event) => {
                onChange(event.target.value as MarkmapViewMode)
            }}
            aria-label="Markmap 视图切换"
            style={{
                //@ts-ignore
                '--semi-border-radius-small': 'var(--radius)'
            }}
        >
            <Radio value="chart">图表</Radio>
            <Radio value="code">源码</Radio>
        </RadioGroup>
    )
}

export default MarkmapSegmented
