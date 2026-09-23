import { Subject } from 'rxjs'
import { HttpEventType } from '@ngify/http'
import type { HttpClientLike } from '../../types'

export const sseFrame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`

/** 可控的假 HttpClient：测试里逐段推送 partialText，每次 post 开一个新的请求 */
export function createFakeHttp() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let subject: Subject<any> | null = null
    let text = ''
    let unsubscribed = false
    let requests = 0
    const httpClient: HttpClientLike = {
        post: () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            subject = new Subject<any>()
            text = ''
            unsubscribed = false
            requests += 1
            const observable = subject.asObservable()
            return {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                subscribe: (observer: any) => {
                    const sub = observable.subscribe(observer)
                    return {
                        unsubscribe: () => {
                            unsubscribed = true
                            sub.unsubscribe()
                        }
                    }
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any
        }
    }
    return {
        httpClient,
        push(chunk: string) {
            text += chunk
            subject!.next({ type: HttpEventType.DownloadProgress, partialText: text })
        },
        respond() {
            subject!.next({ type: HttpEventType.Response, body: text })
            subject!.complete()
        },
        fail(error: unknown) {
            subject!.error(error)
        },
        get unsubscribed() {
            return unsubscribed
        },
        get requests() {
            return requests
        }
    }
}
