import { RadioGroup, Radio, Space } from '@douyinfe/semi-ui'

export type SegmentedType = 'mermaid' | 'code'

export const Segmented = (props: {
    value: SegmentedType
    onChange: (v: SegmentedType) => void
}) => {
    return (
        <RadioGroup
            type="button"
            buttonSize="large"
            defaultValue={props.value}
            value={props.value}
            onChange={(v) => {
                props.onChange(v.target.value)
            }}
            aria-label="单选组合示例"
            name="demo-radio-large"
        >
            <Radio value={'mermaid'}>流程图</Radio>
            <Radio value={'code'}>代码</Radio>
        </RadioGroup>
    )
}
