import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { base, type Asset } from '../shared/api'
import { imageSizes } from './images'

// An image being uploaded shows a placeholder with its progress where it will appear. A failed
// upload keeps the placeholder with retry and remove buttons. Placeholders are decorations, so they
// are never saved.

interface Upload {
  id: number
  file: File
  preview: string
  el: HTMLElement
  xhr?: XMLHttpRequest
  failed: boolean
}

interface Meta {
  add?: { id: number; pos: number; el: HTMLElement }
  remove?: number
}

const key = new PluginKey<DecorationSet>('uploads')
let nextId = 1

export function uploadFile(file: File, onProgress?: (fraction: number) => void): { promise: Promise<Asset>; xhr: XMLHttpRequest } {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<Asset>((resolve, reject) => {
    xhr.open('POST', `${base}api/assets`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      let data: Partial<Asset> & { message?: string } = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        // not JSON
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.url) resolve(data as Asset)
      else reject(new Error(data.message || `服务器返回 ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('网络连接失败'))
    xhr.onabort = () => reject(new Error('已取消'))
    const form = new FormData()
    form.append('file', file, file.name || 'image.png')
    xhr.send(form)
  })
  return { promise, xhr }
}

function uploads(editor: Editor): Map<number, Upload> {
  return (editor.storage as unknown as { uploads: { active: Map<number, Upload> } }).uploads.active
}

// Uploads still running; leaving the editor waits for them.
export function pendingUploads(editor: Editor): number {
  return [...uploads(editor).values()].filter((u) => !u.failed).length
}

export function insertImages(editor: Editor, files: File[], pos?: number) {
  let at = pos
  if (at === undefined) {
    if (!editor.state.selection.empty) editor.commands.deleteSelection()
    at = editor.state.selection.from
  }
  for (const file of files) start(editor, file, at)
}

function start(editor: Editor, file: File, pos: number) {
  const up: Upload = { id: nextId++, file, preview: URL.createObjectURL(file), el: document.createElement('span'), failed: false }
  up.el.className = 'yy-upload'
  up.el.contentEditable = 'false'
  const img = document.createElement('img')
  img.src = up.preview
  img.alt = ''
  const status = document.createElement('span')
  status.className = 'yy-upload-status'
  up.el.append(img, status)
  uploads(editor).set(up.id, up)
  const meta: Meta = { add: { id: up.id, pos, el: up.el } }
  editor.view.dispatch(editor.state.tr.setMeta(key, meta).setMeta('addToHistory', false))
  send(editor, up)
}

function send(editor: Editor, up: Upload) {
  up.failed = false
  up.el.classList.remove('failed')
  const status = up.el.querySelector('.yy-upload-status')!
  status.innerHTML = '<span class="yy-upload-bar"><span></span></span><span class="yy-upload-text">上传中</span>'
  const bar = status.querySelector<HTMLElement>('.yy-upload-bar > span')!
  const text = status.querySelector<HTMLElement>('.yy-upload-text')!
  const { promise, xhr } = uploadFile(up.file, (f) => {
    bar.style.width = `${Math.round(f * 100)}%`
    text.textContent = f < 1 ? `上传中 ${Math.round(f * 100)}%` : '处理中'
  })
  up.xhr = xhr
  promise.then(
    (asset) => finish(editor, up, asset),
    (e: Error) => {
      if (editor.isDestroyed) return
      up.failed = true
      up.el.classList.add('failed')
      status.replaceChildren(
        Object.assign(document.createElement('span'), { className: 'yy-upload-text', textContent: `上传失败：${e.message}` }),
        button('重试', () => send(editor, up)),
        button('移除', () => remove(editor, up)),
      )
    },
  )
}

function button(label: string, run: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.addEventListener('mousedown', (e) => e.preventDefault())
  b.addEventListener('click', run)
  return b
}

function position(editor: Editor, id: number): number | null {
  const found = key.getState(editor.state)?.find(undefined, undefined, (spec) => spec.id === id)
  return found?.length ? found[0].from : null
}

function finish(editor: Editor, up: Upload, asset: Asset) {
  if (editor.isDestroyed) return
  const pos = position(editor, up.id)
  forget(editor, up)
  // The placeholder is gone when the text around it was deleted meanwhile.
  if (pos === null) return
  if (asset.width && asset.height) imageSizes(editor)[asset.id] = [asset.width, asset.height]
  const node = { type: 'image', attrs: { src: asset.url, alt: null, title: null, width: null, height: null } }
  editor
    .chain()
    .command(({ tr }) => {
      tr.setMeta(key, { remove: up.id } satisfies Meta)
      return true
    })
    .insertContentAt(pos, node, { updateSelection: false })
    .run()
}

function remove(editor: Editor, up: Upload) {
  forget(editor, up)
  editor.view.dispatch(editor.state.tr.setMeta(key, { remove: up.id } satisfies Meta).setMeta('addToHistory', false))
}

function forget(editor: Editor, up: Upload) {
  uploads(editor).delete(up.id)
  URL.revokeObjectURL(up.preview)
}

export const UploadPlaceholders = Extension.create({
  name: 'uploads',

  addStorage() {
    return { active: new Map<number, Upload>() }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            let next = set.map(tr.mapping, tr.doc)
            const meta = tr.getMeta(key) as Meta | undefined
            if (meta?.add) next = next.add(tr.doc, [Decoration.widget(meta.add.pos, meta.add.el, { id: meta.add.id, side: meta.add.id, ignoreSelection: true })])
            if (meta?.remove !== undefined) next = next.remove(next.find(undefined, undefined, (spec) => spec.id === meta.remove))
            return next
          },
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ]
  },

  onDestroy() {
    for (const up of this.storage.active.values()) {
      up.xhr?.abort()
      URL.revokeObjectURL(up.preview)
    }
    this.storage.active.clear()
  },
})
