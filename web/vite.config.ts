import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// PDF resources stay local, versioned, and are fetched only by an opened PDF preview.
const pdfRoot = new URL('./node_modules/pdfjs-dist/', import.meta.url)
const pdfVersion = JSON.parse(readFileSync(new URL('package.json', pdfRoot), 'utf8')).version

// Excalidraw starts its font-subsetting worker from a chunk that the page also imports dynamically.
// Bundled with the page, that chunk loads shared chunks holding page code, which fails inside the
// worker. Its import is redirected to a module giving the URL of the same file bundled as a worker
// script of its own; the page keeps Excalidraw's main-thread fallback.
const excalidrawProd = fileURLToPath(new URL('./node_modules/@excalidraw/excalidraw/dist/prod/', import.meta.url))
const subsetWorker = excalidrawProd + 'subset-worker.chunk.js'
const subsetWorkerUrl = '\0excalidraw-subset-worker-url'

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
    name: 'drawing-subset-worker',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === './subset-worker.chunk.js' && importer?.startsWith(excalidrawProd)) return subsetWorkerUrl
    },
    load(id) {
      if (id === subsetWorkerUrl) return `export { default as WorkerUrl } from ${JSON.stringify(subsetWorker + '?worker&url')}`
    },
    generateBundle(_, bundle) {
      if (!this.getModuleInfo(subsetWorkerUrl)) this.error(`Excalidraw no longer imports ./subset-worker.chunk.js; check how it starts the font-subsetting worker`)
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.moduleIds.includes(subsetWorker)) this.error(`the font-subsetting worker is bundled into the page chunk ${chunk.fileName}`)
      }
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
