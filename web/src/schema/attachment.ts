import { Node } from '@tiptap/core'

export const attachmentSource = /^\/attachments\/([0-9a-f]{32})$/
export const maxAttachmentBytes = 25 * 1024 * 1024
export function attachmentName(value: string): string {
  const name = Array.from(value.replace(/\\/g, '/').split('/').pop()!.replace(/[\u0000-\u001f\u007f-\u009f\u202d\u202e]/g, '').trim()).slice(0, 200).join('')
  return !name || name === '.' || name === '..' ? '附件' : name
}
export function attachmentType(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  return ext && Array.from(ext).length <= 8 ? ext.toUpperCase() : 'FILE'
}
export function attachmentSize(size: number): string {
  return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`
}
export function attachmentHref(src: string, name: string): string {
  if (attachmentSource.test(src)) return `${src}?name=${encodeURIComponent(name).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`
  // Exported attachments use local relative paths. Never activate arbitrary protocols from HTML.
  return src && !/[\u0000-\u0020:\\]/.test(src) && !src.startsWith('//') ? src : ''
}

export const Attachment = Node.create({
  name: 'attachment', group: 'block', atom: true, draggable: true,
  addOptions() { return { resolveSrc: (src: string) => src, unresolveSrc: (src: string) => src } },
  addAttributes() {
    return {
      src: { default: '', parseHTML: el => this.options.unresolveSrc(el.getAttribute('data-src') ?? '') },
      name: { default: '附件', parseHTML: el => attachmentName(el.getAttribute('data-name') ?? '') },
      size: { default: 0, parseHTML: el => Math.max(0, Number(el.getAttribute('data-size')) || 0) },
      mime: { default: 'application/octet-stream', parseHTML: el => el.getAttribute('data-mime') || 'application/octet-stream' },
    }
  },
  parseHTML() { return [{ tag: 'div[data-attachment]' }] },
  renderText({ node }) { return node.attrs.name },
  renderHTML({ node }) {
    const { src, name, size, mime } = node.attrs
    return ['div', { 'data-attachment': '', 'data-src': this.options.resolveSrc(src), 'data-name': name, 'data-size': size, 'data-mime': mime },
      ['a', { class: 'yy-attachment-card', href: this.options.resolveSrc(attachmentHref(src, name)), download: name },
        ['span', { class: 'yy-attachment-icon', 'aria-hidden': 'true' }, attachmentType(name)],
        ['span', { class: 'yy-attachment-info' }, ['span', { class: 'yy-attachment-name' }, name], ['span', { class: 'yy-attachment-size' }, attachmentSize(size)]],
        ['span', { class: 'yy-attachment-download', 'aria-label': '下载附件' }, '↓']]]
  },
})
