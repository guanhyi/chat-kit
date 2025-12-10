import ReactDOM from 'react-dom/client'
import { HttpContextProvider } from './http'
import { StoreProvider } from './store'

const rootEl = document.getElementById('root')

if (rootEl) {
    const root = ReactDOM.createRoot(rootEl)
    root.render(
        <>
            <StoreProvider>
                <HttpContextProvider>
                    <>12121</>
                </HttpContextProvider>
            </StoreProvider>
        </>
    )
}
