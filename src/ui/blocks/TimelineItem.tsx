import React from 'react'
import clsx from 'clsx'
import { Check } from 'lucide-react'

export interface TimelineItemProps {
    title: JSX.Element
    description: JSX.Element
    icon?: React.ReactNode
    showLine?: boolean
    highlight?: boolean
    className?: React.HTMLAttributes<'div'>['className']
}

export const TimelineItem: React.FC<TimelineItemProps> = ({
    title,
    description,
    icon,
    showLine = false,
    highlight = false,
    className
}) => {
    return (
        <div
            className={clsx('flex gap-x-1 group', className)}
            data-show-line={showLine}
            data-highlight={highlight}
        >
            {showLine ? (
            <div className="relative last:after:hidden after:absolute after:top-6 after:bottom-0 after:start-3 after:w-px after:-translate-x-[0.5px] after:bg-gray-200">
                <div className="relative z-10 size-6 flex justify-center items-center">
                    {highlight ? (
                        <>
                            <div className="size-5 absolute group-data-[highlight=true]:animate-ping rounded-full group-data-[highlight=true]:bg-[#4376FD] opacity-10 " />
                            <div className="size-5 rounded-full border border-[#4376FD]/25 bg-white text-[#4376FD] flex justify-center items-center">
                                {icon || <Check size={11} />}
                            </div>
                        </>
                    ) : (
                        <div className="size-5 rounded-full border border-gray-200 bg-white text-gray-500 flex justify-center items-center">
                            {icon || <Check size={11} />}
                        </div>
                    )}
                </div>
            </div>
            ) : null}
            <div className="flex-1 min-w-0">
                <h3 className="flex gap-x-1.5 text-[13px] font-medium leading-5 text-gray-700 w-full">
                    {title}
                </h3>
                <div className="mt-1 text-[12px] leading-5 text-gray-500">{description}</div>
            </div>
        </div>
    )
}

export default TimelineItem
