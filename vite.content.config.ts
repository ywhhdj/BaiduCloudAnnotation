import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'

export default defineConfig({
  plugins: [
    vue(),
    cssInjectedByJsPlugin(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,       // 不要清掉主构建产物
    minify: true,            // 调试期保留；上线可改 true
    cssCodeSplit: false,      // 配合 cssInjectedByJsPlugin 全部内联
    rollupOptions: {
      input: 'src/core/content/index.ts',
      output: {
        format: 'iife',
        name: 'PointCloudContent',
        entryFileNames: 'js/content.js',
        inlineDynamicImports: true,   // IIFE 不允许 code-split
      }
    }
  }
})