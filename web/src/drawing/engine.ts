import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawImperativeAPI, BinaryFiles } from '@excalidraw/excalidraw/types'
type ExcalidrawElement = ReturnType<ExcalidrawImperativeAPI['getSceneElements']>[number]
import type { DrawingPackage } from './types'
import { templateSkeleton } from './templates'
import { assetURL, uploadImage } from '../shared/api'

export interface SceneDraft {
  elements: readonly ExcalidrawElement[]
  appState: { viewBackgroundColor: string }
  files: BinaryFiles
}

let library: Promise<typeof import('@excalidraw/excalidraw')> | undefined
export function engineLibrary() {
  // Configure before importing the engine: its default font URL is a public CDN.
  ;(window as any).EXCALIDRAW_ASSET_PATH = new URL('./excalidraw-0.18.1/', import.meta.url).href
  return library ??= import('@excalidraw/excalidraw')
}

export async function hydrateDrawing(pkg?: DrawingPackage): Promise<SceneDraft> {
  if (!pkg) return { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }
  if (pkg.version !== 1 || pkg.engineVersion !== '0.18.1') throw new Error('此画板版本暂不支持编辑，请下载源文件并更新 Yuyan')
  const files: BinaryFiles = {}
  await Promise.all(Object.entries(pkg.files).map(async ([id, file]) => {
    const response = await fetch(assetURL(file.src))
    if (!response.ok) throw new Error('画板图片无法加载')
    const blob = await response.blob()
    files[id] = { id, dataURL: await dataURL(blob), mimeType: file.mimeType, created: 0 } as BinaryFiles[string]
  }))
  return { ...pkg.scene, elements: pkg.scene.elements as unknown as ExcalidrawElement[], files }
}

function dataURL(blob: Blob): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function mountEngine(container: HTMLElement, initial: SceneDraft, changed: (draft: SceneDraft) => void) {
  const lib = await engineLibrary()
  const root = createRoot(container)
  let api!: ExcalidrawImperativeAPI
  let disposed = false, sceneReady = false
  const ready = new Promise<void>(resolve => {
    root.render(createElement(lib.Excalidraw, {
      langCode: 'zh-CN', theme: 'light', autoFocus: true, handleKeyboardGlobally: false,
      initialData: { ...initial, appState: { ...initial.appState, currentItemRoughness: 0, currentItemFillStyle: 'solid', currentItemFontFamily: 2, currentItemStrokeWidth: 1, exportBackground: true, exportWithDarkMode: false, exportEmbedScene: false }, scrollToContent: true },
      excalidrawAPI: (value: ExcalidrawImperativeAPI) => { api = value; if (sceneReady) resolve() },
      onChange: (elements, state, files) => {
        if (!disposed) changed({ elements, appState: { viewBackgroundColor: state.viewBackgroundColor }, files })
        sceneReady = !state.isLoading
        if (api && sceneReady) resolve()
      },
      validateEmbeddable: false,
      UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false } },
      renderTopRightUI: () => null,
    }))
  })
  await ready
  return {
    api,
    destroy() { disposed = true; root.unmount() },
    capture(): SceneDraft { return structuredClone({ elements: api.getSceneElements(), appState: { viewBackgroundColor: api.getAppState().viewBackgroundColor }, files: api.getFiles() }) },
    async template(id: string) {
      const skeleton = templateSkeleton(id).map(e => ({ roughness: 0, fillStyle: 'solid', strokeWidth: 1, fontFamily: 2, ...e }))
      const elements = lib.convertToExcalidrawElements(skeleton as any, { regenerateIds: false })
      api.resetScene()
      api.updateScene({ elements, appState: { viewBackgroundColor: '#ffffff' }, captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY })
      api.scrollToContent(undefined, { fitToContent: true })
    },
    async importFile(file: File) {
      if (file.size > 12 * 1024 ** 2) throw new Error('导入画板最大 12 MiB')
      const raw = JSON.parse(await file.text())
      if (raw.type !== 'excalidraw' || raw.version !== 2 || !Array.isArray(raw.elements)) throw new Error('请选择有效的 .excalidraw 文件')
      if (raw.elements.some((e: any) => e.type === 'embeddable' || e.type === 'iframe')) throw new Error('暂不支持网页嵌入，请先移除后再导入')
      for (const f of Object.values(raw.files ?? {}) as any[]) {
        if (!/^data:image\/(png|jpeg|gif|webp|bmp);base64,/.test(f.dataURL)) throw new Error('导入仅支持 PNG/JPEG/GIF/WebP/BMP 图片')
      }
      const restored = lib.restore(raw, null, null)
      api.resetScene()
      api.addFiles(Object.values(restored.files))
      api.updateScene({ elements: restored.elements, appState: { viewBackgroundColor: restored.appState.viewBackgroundColor || '#ffffff' }, captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY })
      api.scrollToContent(undefined, { fitToContent: true })
    },
  }
}

function persistentScene(draft: SceneDraft): SceneDraft {
  const elements = draft.elements.filter(e => !e.isDeleted).map(e => {
    if (e.type === 'embeddable' || e.type === 'iframe') throw new Error('暂不支持网页嵌入')
    // Links are an external action; v1 stores only the drawing itself.
    const { customData: _custom, ...clean } = e
    return { ...clean, link: null }
  })
  if (!elements.length) throw new Error('请先添加图形或文字')
  const used = new Set(elements.filter(e => e.type === 'image').map(e => e.fileId))
  const files = Object.fromEntries(Object.entries(draft.files).filter(([id]) => used.has(id as any)))
  for (const id of used) if (!id || !files[id]) throw new Error('画板包含尚未加载的图片，请稍后再试')
  return { elements, appState: { viewBackgroundColor: draft.appState.viewBackgroundColor || '#ffffff' }, files }
}

export async function buildPackage(draft: SceneDraft): Promise<DrawingPackage> {
  const lib = await engineLibrary(), frozen = persistentScene(structuredClone(draft))
  const files: DrawingPackage['files'] = {}
  for (const [id, file] of Object.entries(frozen.files)) {
    if (!/^data:image\/(png|jpeg|gif|webp|bmp);base64,/.test(file.dataURL)) throw new Error('画板图片仅支持 PNG/JPEG/GIF/WebP/BMP')
    const blob = await (await fetch(file.dataURL)).blob()
    const asset = await uploadImage(new File([blob], 'drawing-image', { type: file.mimeType }))
    files[id] = { src: asset.url, mimeType: asset.mime }
  }
  const options = { elements: frozen.elements, appState: { ...frozen.appState, exportBackground: true, exportWithDarkMode: false, exportEmbedScene: false }, files: frozen.files, exportPadding: 20 }
  let preview: DrawingPackage['preview']
  if (Object.keys(files).length || frozen.elements.some(e => e.type === 'text' && e.fontFamily !== 2)) {
    const canvas = await lib.exportToCanvas({ ...options, maxWidthOrHeight: 2400 })
    preview = { mime: 'image/png', data: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height }
  } else {
    const svg = await lib.exportToSvg({ ...options, skipInliningFonts: true }) as SVGSVGElement
    // Technical diagrams use browser system fonts. Remove font CSS and metadata;
    // do not persist external URLs, duplicate scene JSON or per-drawing fonts.
    svg.querySelectorAll('style, metadata').forEach(el => el.remove())
    for (const el of [svg, ...svg.querySelectorAll('*')]) {
      if (el instanceof SVGElement) {
        for (const name of ['font-family', 'font-size', 'font-weight', 'white-space']) {
          const value = el.style.getPropertyValue(name)
          if (value) el.setAttribute(name, value)
        }
      }
      for (const a of [...el.attributes]) if (a.name === 'style' || a.name.startsWith('data-') || a.name === 'class') el.removeAttribute(a.name)
    }
    preview = { mime: 'image/svg+xml', data: svg.outerHTML, width: Math.ceil(Number(svg.getAttribute('width'))), height: Math.ceil(Number(svg.getAttribute('height'))) }
  }
  return { format: 'yuyan-drawing', version: 1, engine: 'excalidraw', engineVersion: '0.18.1', scene: { elements: frozen.elements as unknown as Record<string, any>[], appState: frozen.appState }, files, preview }
}

export async function downloadScene(draft: SceneDraft, format: 'excalidraw' | 'svg' | 'png') {
  const lib = await engineLibrary(), scene = persistentScene(draft)
  let blob: Blob
  if (format === 'excalidraw') blob = new Blob([lib.serializeAsJSON(scene.elements, scene.appState, scene.files, 'local')], { type: 'application/json' })
  else if (format === 'svg') blob = new Blob([(await lib.exportToSvg({ elements: scene.elements, appState: { ...scene.appState, exportBackground: true, exportEmbedScene: false }, files: scene.files })).outerHTML], { type: 'image/svg+xml' })
  else blob = await lib.exportToBlob({ elements: scene.elements, appState: { ...scene.appState, exportBackground: true, exportEmbedScene: false }, files: scene.files, mimeType: 'image/png' })
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = `drawing.${format}`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
