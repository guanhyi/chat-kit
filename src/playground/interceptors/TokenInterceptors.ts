import { HttpEvent, HttpHandlerFn, HttpRequest } from '@ngify/http'
import { Observable } from 'rxjs'
import { StoreEscape } from '../store'
import { userStore } from '../store/user'

export function TokenInterceptor(
    req: HttpRequest<unknown>,
    next: HttpHandlerFn
): Observable<HttpEvent<unknown>> {
    const user = StoreEscape.get(userStore)
    if (user?.token) {
        const newReq = req.clone({
            headers: req.headers.set('Authorization', user.token || '')
            // .set("Access-Control-Allow-Headers", "*"),
        })
        return next(newReq)
    }
    return next(req)
}
