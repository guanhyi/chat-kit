import { Tooltip, Button } from '@douyinfe/semi-ui'
import { useModal } from '@ebay/nice-modal-react'
import { Fullscreen, ScanEye } from 'lucide-react'
import { fit } from 'svg-pan-zoom'
import { FullscreenModal } from '../FullscreenModal'

export const FullscreenButton = (props: { code: string }) => {
    const modal = useModal(FullscreenModal)
    const open = () => {
        modal.show({ code: props.code })
    }
    return (
        <Tooltip content="全屏">
            <Button
                onClick={open}
                className="rounded-full p-[6px] h-[28px] w-[28px]"
                type="tertiary"
                theme="borderless"
            >
                <Fullscreen size={16} />
            </Button>
        </Tooltip>
    )
}
