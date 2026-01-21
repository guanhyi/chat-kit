import ReactMarkdown, { Options } from 'react-markdown'
import { animations } from './utils'
import { Fragment, useCallback, useMemo } from 'react'
import TokenizedText from './SplitText'
import AnimatedImage from './AnimatedImage'

export type MarkdownAnimateProps = {
    content: string
    sep?: string
    animation?: string
    animationDuration?: string
    animationTimingFunction?: string
    imgHeight?: string
}

export const AnimatedMarkdown = ({
    content,
    sep = 'diff',
    animation: animationName = 'fadeIn',
    animationDuration = '1s',
    animationTimingFunction = 'ease-in-out',
    components = {},
    imgHeight = '20rem',
    ...rest
}: MarkdownAnimateProps & Options) => {
    const animation = animations[animationName as keyof typeof animations] || animationName
    const animationStyle: any = {
        animation: `${animation} ${animationDuration} ${animationTimingFunction}`
    }

    const hidePartialCustomComponents = useCallback(
        (input: string): React.ReactNode => {
            if (!input || Object.keys(components as any).length === 0) return input

            // Check for any opening tag without a closing '>'
            const lastOpeningBracketIndex = input.lastIndexOf('<')
            if (lastOpeningBracketIndex !== -1) {
                const textAfterLastOpeningBracket = input.substring(lastOpeningBracketIndex)

                // If there's no closing bracket, then it's potentially a partial tag
                if (!textAfterLastOpeningBracket.includes('>')) {
                    // Check if it starts with any of our custom component names
                    for (const tag of Object.keys(components as any)) {
                        // Check if the text starts with the tag name (allowing for partial tag name)
                        // For example, '<Cus' would match a component named 'CustomTag'
                        if (
                            textAfterLastOpeningBracket
                                .substring(1)
                                .startsWith(
                                    tag.substring(0, textAfterLastOpeningBracket.length - 1)
                                ) ||
                            // Or it's a complete tag name followed by attributes
                            textAfterLastOpeningBracket.match(new RegExp(`^<${tag}(\\s|$)`))
                        ) {
                            // Remove the partial tag
                            return input.substring(0, lastOpeningBracketIndex)
                        }
                    }
                }
            }

            return input
        },
        [components]
    )

    // Memoize animateText function to prevent recalculations if props do not change
    const animateText: (text: string | Array<any>) => React.ReactNode = useCallback(
        (text: string | Array<any>) => {
            text = Array.isArray(text) ? text : [text]
            let keyCounter = 0
            const processText: (input: any, keyPrefix?: string) => React.ReactNode = (
                input: any,
                keyPrefix: string = 'item'
            ) => {
                if (Array.isArray(input)) {
                    // Process each element in the array
                    return input.map((element, index) => (
                        <Fragment key={`${keyPrefix}-${index}`}>
                            {processText(element, `${keyPrefix}-${index}`)}
                        </Fragment>
                    ))
                } else if (typeof input === 'string') {
                    // if (!animation) return input;
                    return (
                        <TokenizedText
                            key={`pcc-${keyCounter++}`}
                            input={hidePartialCustomComponents(input)}
                            sep={sep}
                            animation={animation}
                            animationDuration={animationDuration}
                            animationTimingFunction={animationTimingFunction}
                            animationIterationCount={1}
                        />
                    )
                } else {
                    // Return non-string, non-element inputs unchanged (null, undefined, etc.)
                    return (
                        <span
                            key={`pcc-${keyCounter++}`}
                            style={{
                                animationName: animation,
                                animationDuration,
                                animationTimingFunction,
                                animationIterationCount: 1,
                                whiteSpace: 'pre-wrap',
                                display: 'inline-block'
                            }}
                        >
                            {input}
                        </span>
                    )
                }
            }
            if (!animation) {
                return text
            }
            return processText(text)
        },
        [animation, animationDuration, animationTimingFunction, sep, hidePartialCustomComponents]
    )

    const animatedComponents: any = useMemo(
        () => ({
            text: ({ node, ...props }: any) => animateText(props.children),
            h1: ({ node, ...props }: any) => <h1 {...props}>{animateText(props.children)}</h1>,
            h2: ({ node, ...props }: any) => <h2 {...props}>{animateText(props.children)}</h2>,
            h3: ({ node, ...props }: any) => <h3 {...props}>{animateText(props.children)}</h3>,
            h4: ({ node, ...props }: any) => <h4 {...props}>{animateText(props.children)}</h4>,
            h5: ({ node, ...props }: any) => <h5 {...props}>{animateText(props.children)}</h5>,
            h6: ({ node, ...props }: any) => <h6 {...props}>{animateText(props.children)}</h6>,
            p: ({ node, ...props }: any) => <p {...props}>{animateText(props.children)}</p>,
            li: ({ node, ...props }: any) => (
                <li {...props} className="custom-li" style={animationStyle}>
                    {animateText(props.children)}
                </li>
            ),
            a: ({ node, ...props }: any) => (
                <a {...props} href={props.href} target="_blank" rel="noopener noreferrer">
                    {animateText(props.children)}
                </a>
            ),
            strong: ({ node, ...props }: any) => (
                <strong {...props}>{animateText(props.children)}</strong>
            ),
            em: ({ node, ...props }: any) => <em {...props}>{animateText(props.children)}</em>,
            // code: ({ node, className, children, ...props }: any) => {
            //     return (
            //         <DefaultCode
            //             node={node}
            //             className={className}
            //             style={animationStyle}
            //             codeStyle={codeStyle}
            //             animateText={animateText}
            //             animation={animation as string}
            //             animationDuration={animationDuration}
            //             animationTimingFunction={animationTimingFunction}
            //             {...props}
            //         >
            //             {children}
            //         </DefaultCode>
            //     )
            // },
            hr: ({ node, ...props }: any) => (
                <hr
                    {...props}
                    style={{
                        animationName: animation,
                        animationDuration,
                        animationTimingFunction,
                        animationIterationCount: 1,
                        whiteSpace: 'pre-wrap'
                    }}
                />
            ),
            img: ({ node, ...props }: any) => (
                <AnimatedImage
                    src={props.src}
                    height={imgHeight}
                    alt={props.alt}
                    animation={animation || ''}
                    animationDuration={animationDuration}
                    animationTimingFunction={animationTimingFunction}
                    animationIterationCount={1}
                />
            ),
            // table: ({ node, ...props }: any) => (
            //     <table {...props} style={animationStyle}>
            //         {props.children}
            //     </table>
            // ),
            // tr: ({ node, ...props }: any) => <tr {...props}>{animateText(props.children)}</tr>,
            // td: ({ node, ...props }: any) => <td {...props}>{animateText(props.children)}</td>,
            ...Object.entries(components as any).reduce(
                (acc, [key, value]) => {
                    //@ts-ignores
                    acc[key] = (elements: any) => value({ ...elements, animateText })
                    return acc
                },
                {} as Record<string, (elements: any) => React.ReactNode>
            )
        }),
        [animateText, components, animation, animationDuration, animationTimingFunction]
    )

    return (
        <ReactMarkdown components={animatedComponents} {...rest}>
            {content}
        </ReactMarkdown>
    )
}
