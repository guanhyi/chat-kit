import { useModal } from '@ebay/nice-modal-react'
import { Button, Tooltip } from '@douyinfe/semi-ui'
import { Fullscreen } from 'lucide-react'
import type { IMarkmapJSONOptions } from 'markmap-view'
import { FullscreenModal } from './FullscreenModal'

interface FullscreenButtonProps {
    code: string
    jsonOptions?: Partial<IMarkmapJSONOptions>
}

const FullscreenButton: React.FC<FullscreenButtonProps> = ({ code, jsonOptions }) => {
    const modal = useModal(FullscreenModal)

    return (
        <Tooltip content="全屏">
            <Button
                onClick={() => {
                    modal.show({ code, jsonOptions })
                }}
                className="h-[28px] w-[28px] rounded-full p-[6px]"
                type="tertiary"
                theme="borderless"
            >
                <Fullscreen size={16} />
            </Button>
        </Tooltip>
    )
}

export default FullscreenButton
