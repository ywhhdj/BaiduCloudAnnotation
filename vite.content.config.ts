import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'

export default defineConfig({
  plugins: [
    vue(),
    // content script 不会自动加载 css，必须把样式字符串注入到 JS
    cssInjectedByJsPlugin(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  define: {
    // Vue 3.4+ 需要显式声明这三个特性标志，IIFE 里没有 vite 的默认注入
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
      input: 'src/content/index.ts',
      output: {
        format: 'iife',
        name: 'PointCloudContent',
        entryFileNames: 'js/content.js',
        inlineDynamicImports: true,   // IIFE 不允许 code-split
        // ⚠️ 不要写 manualChunks，否则会触发 code-split 报错
      }
    }
  }
})