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
    name: 'drawing-resources',
    generateBundle() {
      const root = new URL('./node_modules/@excalidraw/excalidraw/dist/prod/', import.meta.url)
      const copy = (dir: string) => {
        for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) {
          const path = dir + entry.name
          if (entry.isDirectory()) copy(path + '/')
          else this.emitFile({ type: 'asset', fileName: `assets/excalidraw-0.18.1/${path}`, source: readFileSync(new URL(path, root)) })
        }
      }
      copy('fonts/')
      const licenses = new URL('./licenses/excalidraw/', import.meta.url)
      for (const name of readdirSync(licenses)) this.emitFile({ type: 'asset', fileName: `assets/excalidraw-0.18.1/licenses/${name}`, source: readFileSync(new URL(name, licenses)) })
    },
  }, {
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
      preserveEntrySignatures: 'strict',
      input: { app: 'src/app/main.ts', 'drawing-tool': 'src/drawing/tool.ts' },
    },
  },
})
