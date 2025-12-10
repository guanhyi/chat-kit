import { useHttp } from '../http'
import { RemoteResultDTO } from './type'

export type LoginParam = {
    username: string
    password: string
}

export type UserInfo = {
    id: string

    /**用户名 */
    username: string
    /**姓名**/
    realName: string
    /**权限码集合 */
    permissionList: string[]
    /**角色编码集合 */
    roleList: string[]

    /**令牌 */
    token: string
    /**登录IP */
    ip: string
    /**登录地址 */
    address: string
    /**浏览器类型 */
    browser: string
    /**登录次数 */
    loginCount: number
}

export const LoginService = () => {
    const http = useHttp()

    const login = (data: LoginParam) => {
        return http?.post<RemoteResultDTO<UserInfo>>('/auth/login', {
            ...data
        })
    }

    return {
        login
    }
}
