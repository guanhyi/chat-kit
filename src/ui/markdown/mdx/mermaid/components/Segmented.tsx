import { RadioGroup, Radio, Space } from '@douyinfe/semi-ui'

export type SegmentedType = 'mermaid' | 'code'

export const Segmented = (props: {
    value: SegmentedType
    onChange: (v: SegmentedType) => void
}) => {
    return (
        <RadioGroup
            type="button"
            buttonSize="middle"
            defaultValue={props.value}
            value={props.value}
            onChange={(v) => {
                props.onChange(v.target.value)
            }}
            aria-label="单选组合示例"
            style={{
                //@ts-ignore
                '--semi-border-radius-small': 'var(--radius)'
            }}
        >
            <Radio value={'mermaid'}>图表</Radio>
            <Radio value={'code'}>源码</Radio>
        </RadioGroup>
    )
}
