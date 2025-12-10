import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginStyledComponents } from '@rsbuild/plugin-styled-components'
import { pluginCheckSyntax } from '@rsbuild/plugin-check-syntax'
// import { pluginEnv } from "./scripts/env";
// 根据构建环境切换产物目录：
// - BUILD_NODE_ENV=test       -> dist/test
// - BUILD_NODE_ENV=production -> dist/prod
// - 其他（dev）               -> dist/dev

export default defineConfig({
    plugins: [pluginReact(), pluginStyledComponents()],

    performance: {
        chunkSplit: {
            strategy: 'split-by-experience'
        }
    },
    output: {
        assetPrefix: './',
        polyfill: 'entry'
    },
    source: {
        entry: {
            index: './src/playground/index.tsx'
        }
    },

    server: {
        proxy: {
            '/proxy/': {
                target: 'https://zx.lszwfw.cn:7869',
                ws: true,
                secure: true,
                // target: "http://192.168.50.211:8080",
                changeOrigin: true,
                pathRewrite: (path) => path.replace(/^\/proxy/, '')
            },
            '/wenshu/': {
                target: 'https://zx.lszwfw.cn:7869',
                // target: "http://127.0.0.1:8080/",
                ws: true,
                secure: true,
                // target: "http://192.168.50.211:8080",
                changeOrigin: true
                // pathRewrite: (path) => path.replace(/^\/wenshu/, ""),
            }
        }
    }
})
