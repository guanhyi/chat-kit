import { createStore, Provider } from 'jotai'

export const StoreEscape = createStore()

export const StoreProvider = (props: { children: React.ReactNode }) => {
    return <Provider store={StoreEscape}>{props.children}</Provider>
}
