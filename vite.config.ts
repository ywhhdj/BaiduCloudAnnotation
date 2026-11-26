import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

const entries = {
  popup: {
    html: 'popup.html',
    title: 'Popup页面'
  },
  options: {
    html: 'options.html',
    title: '主页面'
  }
}

const getEntryConfig = (entryName: string = 'popup') => {
  return entries[entryName as keyof typeof entries] || entries.popup
}
const entryConfig = getEntryConfig('options')

const pathSrc = path.resolve(__dirname, 'src');
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools()
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  build: {
    rollupOptions: {
      input: {
        options: 'options.html',
        popup: 'popup.html',
        background: 'src/core/background/index.ts',
        inject: 'src/core/page/inject.ts',
        "detect.worker": 'src/core/workers/detect.worker.ts',
        "fit.worker": 'src/core/workers/fit.worker.ts',
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background' || chunkInfo.name === 'popup' || chunkInfo.name === 'inject' || chunkInfo.name === 'overlay' || chunkInfo.name === 'detect.worker' || chunkInfo.name === 'fit.worker') {
            return 'js/[name].js'
          }
          return 'js/[name]-[hash].js'
        },
        chunkFileNames: 'js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const names = assetInfo.name?.split('.') || []
          const extname = names[names.length - 1]
          if (extname === "css") {
            return "css/[name]-[hash][extname]"
          } else if (extname === "js") {
            return "js/[name]-[hash][extname]"
          } else if (extname === "png") {
            return "assets/png/[name]-[hash][extname]"
          }
          return "assets/[name]-[hash][extname]"
        },
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return id.toString().split('node_modules/')[1].split('/')[0].toString();
          }
        }
      }
    },
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    open: `./${entryConfig.html}`
  }
}
)
