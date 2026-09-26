import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Go serves one page shell for every route, so the build has a single script entry instead of an
// index.html. The editor, KaTeX and Mermaid are split into chunks loaded on demand.
export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    manifest: 'manifest.json',
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: { app: 'src/app/main.ts' },
    },
  },
})
