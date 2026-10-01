import { getDocument, GlobalWorkerOptions, version, type RenderTask } from 'pdfjs-dist'
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { base } from '../../shared/api'

GlobalWorkerOptions.workerSrc = workerURL

export async function loadPDF(url: string, signal: AbortSignal) {
  const assets = `${base}static/assets/pdfjs-${version}/`
  const task = getDocument({ url, cMapUrl: assets + 'cmaps/', standardFontDataUrl: assets + 'standard_fonts/', wasmUrl: assets + 'wasm/', iccUrl: assets + 'iccs/',
    maxImageSize: 32 * 1024 * 1024, canvasMaxAreaInBytes: 32 * 1024 * 1024 })
  const destroy = () => { void task.destroy().catch(() => {}) }
  signal.addEventListener('abort', destroy, { once: true })
  if (signal.aborted) destroy()
  let renderTask: RenderTask | undefined, generation = 0
  try {
    const pdf = await task.promise
    return {
      pages: pdf.numPages,
      async render(canvas: HTMLCanvasElement, number: number, width: number) {
        const token = ++generation
        renderTask?.cancel()
        await renderTask?.promise.catch(() => {})
        if (signal.aborted || token !== generation) return
        const page = await pdf.getPage(number)
        if (signal.aborted || token !== generation) return
        const natural = page.getViewport({ scale: 1 })
        const scale = Math.min(width / natural.width, 2)
        const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(8e6 / (natural.width * natural.height * scale * scale)))
        const viewport = page.getViewport({ scale: scale * ratio })
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
        canvas.style.width = `${viewport.width / ratio}px`; canvas.style.height = `${viewport.height / ratio}px`
        renderTask = page.render({ canvas, viewport })
        await renderTask.promise
      },
    }
  } catch (e) {
    destroy()
    throw e
  }
}
