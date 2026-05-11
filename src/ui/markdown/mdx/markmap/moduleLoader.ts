import type { IAssets } from 'markmap-lib'

type MarkmapLibModule = typeof import('markmap-lib')
type MarkmapViewModule = typeof import('markmap-view')

export type MarkmapModules = Readonly<{
    Transformer: MarkmapLibModule['Transformer']
    transformer: InstanceType<MarkmapLibModule['Transformer']>
    Markmap: MarkmapViewModule['Markmap']
    deriveOptions: MarkmapViewModule['deriveOptions']
    loadCSS: MarkmapViewModule['loadCSS']
    loadJS: MarkmapViewModule['loadJS']
    markmapView: MarkmapViewModule
}>

let modulesPromise: Promise<MarkmapModules> | null = null

export async function getMarkmapModules() {
    if (!modulesPromise) {
        modulesPromise = Promise.all([import('markmap-lib'), import('markmap-view')]).then(
            ([lib, view]) => ({
            Transformer: lib.Transformer,
            transformer: new lib.Transformer(),
            Markmap: view.Markmap,
            deriveOptions: view.deriveOptions,
            loadCSS: view.loadCSS,
            loadJS: view.loadJS,
            markmapView: view
            })
        )
    }

    return modulesPromise
}

export async function loadMarkmapAssets(modules: MarkmapModules, assets: IAssets) {
    if (assets.styles?.length) {
        await modules.loadCSS(assets.styles)
    }

    if (assets.scripts?.length) {
        await modules.loadJS(assets.scripts, {
            getMarkmap: () => modules.markmapView
        })
    }
}
