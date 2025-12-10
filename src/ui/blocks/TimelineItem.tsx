import React from 'react'
import clsx from 'clsx'
import { Check } from 'lucide-react'

export interface TimelineItemProps {
    title: JSX.Element
    description: JSX.Element
    showLine?: boolean
    highlight?: boolean
    className?: React.HTMLAttributes<'div'>['className']
}

export const TimelineItem: React.FC<TimelineItemProps> = ({
    title,
    description,
    showLine = true,
    highlight = false,
    className
}) => {
    return (
        <div
            className={clsx('flex gap-x-1 group', className)}
            data-show-line={showLine}
            data-highlight={highlight}
        >
            <div className="relative last:after:hidden after:absolute after:top-7 after:bottom-0 after:start-3.5 after:w-px after:-translate-x-[0.5px] after:bg-gray-200">
                <div className="relative z-10 size-7 flex justify-center items-center">
                    {highlight ? (
                        <>
                            <div className="size-3 absolute group-data-[highlight=true]:animate-ping rounded-full group-data-[highlight=true]:bg-[#4376FD] opacity-20 " />
                            <div className="size-2 rounded-full bg-[#4376FD] " />
                        </>
                    ) : (
                        <div className="size-4 rounded-full bg-[#4376FD] flex justify-center items-center ">
                            <Check size={12} className="text-white" />
                        </div>
                    )}
                </div>
            </div>
            <div className="flex-1 min-w-0">
                <h3 className="flex gap-x-1.5 font-semibold text-gray-800 w-full">{title}</h3>
                <div className="mt-1 text-gray-600">{description}</div>
            </div>
        </div>
    )
}

export default TimelineItem

