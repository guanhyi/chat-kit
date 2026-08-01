import { unified } from 'unified'
import remarkGfm from 'remark-gfm'
import markdown from 'remark-parse'
import remarkBreaks from 'remark-breaks'
import remarkFrontmatter from 'remark-frontmatter'
import docx, { DocxOptions } from './core'
import { Download } from 'lucide-react'
import { saveAs } from 'file-saver'

import { CHINESE_NUMBERINGS, GMDocumentStandard } from './unit'
import { ORDERED_LIST_REF } from './core/transformer'
import { Tooltip } from '@douyinfe/semi-ui'

type MdToDocProps = {
    content: any
    fileName: string
    afterFileName?: string
    size?: number
    docxOptions?: DocxOptions
} & React.HTMLAttributes<HTMLDivElement>

export const MdToDoc = (props: MdToDocProps) => {
    const processor = unified()
        .use(markdown)
        .use(remarkGfm)
        .use(remarkBreaks)
        .use(remarkFrontmatter)
        .use(docx, {
            output: 'blob',
            styles: GMDocumentStandard,
            ...props.docxOptions
            // numbering: {
            //   config: [
            //     {
            //       reference: ORDERED_LIST_REF,
            //       levels: CHINESE_NUMBERINGS,
            //     },
            //   ],
            // },
        } as DocxOptions)
    const process = async () => {
        const doc = await processor.process(props.content)
        const buffer = await doc.result

        /**清洗fileName前15个字去除空格,并且加上-知行 */
        const newFileName = `${props.fileName.trim().slice(0, 15)}${props.afterFileName ?? ''}.docx`
        if (props.onClick) {
            //@ts-ignore
            props.onClick()
        }
        //@ts-ignore
        saveAs(buffer, newFileName)
    }

    return (
        <Tooltip content="下载">
            <div onClick={process} className={props.className}>
                <Download size={props.size} />
            </div>
        </Tooltip>
    )
}
