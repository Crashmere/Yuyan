export interface PreviewAttachment { src: string; name: string; download: string; size: string }
export interface ArchiveEntry { path: string; size: number; dir?: boolean }
export interface AttachmentPreview {
  kind: 'image' | 'text' | 'pdf' | 'audio' | 'video' | 'archive' | 'unsupported'
  text?: string
  entries?: ArchiveEntry[]
  truncated?: boolean
  message?: string
}

// Upgrade only the reading DOM. Exported HTML keeps its portable download link.
export function prepareAttachmentCards(root: HTMLElement) {
  for (const link of root.querySelectorAll<HTMLAnchorElement>('[data-attachment] > a.yy-attachment-card')) {
    const card = document.createElement('div')
    card.className = 'yy-attachment-card yy-attachment-readable'
    const open = document.createElement('button')
    open.type = 'button'; open.className = 'yy-attachment-open'
    open.setAttribute('aria-label', `预览 ${link.download}`)
    link.querySelector('.yy-attachment-download')?.remove()
    open.append(...link.childNodes)
    const download = document.createElement('a')
    download.className = 'yy-icon-btn yy-attachment-action'
    download.href = link.href; download.download = link.download
    download.setAttribute('aria-label', '下载附件'); download.dataset.tip = '下载附件'
    download.textContent = '↓'
    card.append(open, download); link.replaceWith(card)
  }
}

export interface ArchiveNode { path: string; name: string; dir: boolean; size: number; children: Map<string, ArchiveNode> }
export function archiveTree(entries: ArchiveEntry[]) {
  const root = new Map<string, ArchiveNode>()
  for (const entry of entries) {
    const parts = entry.path.replace(/\\/g, '/').split('/').filter(Boolean)
    // Bound UI depth even for unusual archive paths; keep the remaining path visible as text.
    if (parts.length > 24) parts.splice(23, parts.length - 23, parts.slice(23).join('/'))
    let children = root, path = ''
    parts.forEach((name, index) => {
      path += '/' + name
      let node = children.get(name)
      const dir = index < parts.length - 1 || !!entry.dir
      if (!node) { node = { path, name, dir, size: entry.size, children: new Map() }; children.set(name, node) }
      if (dir) node.dir = true
      if (index === parts.length - 1) node.size = entry.size
      children = node.children
    })
  }
  return root
}

export function fileSize(size: number) {
  return size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`
}
