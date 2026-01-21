export type RemoteResultDTO<T> = {
    //数据
    data: T
    //状态
    code: string

    // 返回提示
    msg: string
}
