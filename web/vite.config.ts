import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Pages are rendered by Go, so the build has two script entries instead of an index.html.
export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    manifest: 'manifest.json',
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: {
        reader: 'src/reader/main.ts',
        editor: 'src/editor/main.ts',
      },
    },
  },
})
