import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync, readdirSync } from 'node:fs'

// PDF resources stay local, versioned, and are fetched only by an opened PDF preview.
const pdfRoot = new URL('./node_modules/pdfjs-dist/', import.meta.url)
const pdfVersion = JSON.parse(readFileSync(new URL('package.json', pdfRoot), 'utf8')).version

// Go serves one page shell for every route, so the build has a single script entry instead of an
// index.html. The editor, KaTeX and Mermaid are split into chunks loaded on demand.
export default defineConfig({
  base: './',
  plugins: [vue(), {
    name: 'pdf-preview-resources',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: `assets/pdfjs-${pdfVersion}/LICENSE`, source: readFileSync(new URL('LICENSE', pdfRoot)) })
      for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
        for (const name of readdirSync(new URL(dir + '/', pdfRoot))) {
          if (name.startsWith('quickjs')) continue // No PDF scripting runtime.
          this.emitFile({ type: 'asset', fileName: `assets/pdfjs-${pdfVersion}/${dir}/${name}`, source: readFileSync(new URL(`${dir}/${name}`, pdfRoot)) })
        }
      }
    },
  }],
  worker: { format: 'es' },
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
