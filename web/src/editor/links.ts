import { base } from '../shared/api'

// normalizeHref cleans what the user typed as a link. Addresses of this site become site paths
// such as /docs/12, which the reading view resolves and the export rewrites; a bare host name
// gets https://.
export function normalizeHref(value: string): string {
  const href = value.trim()
  if (!href) return ''
  const site = new URL(base, location.origin).href
  if (href.startsWith(site)) return `/${href.slice(site.length)}`
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return href
  if (/^[^\s/]+\.[^\s/]+/.test(href)) return `https://${href}`
  return href
}

// openHref opens a link from the editor in a new tab, so the document being edited stays open.
export function openHref(href: string) {
  const url = href.startsWith('/') ? base.replace(/\/$/, '') + href : href
  window.open(url, '_blank', 'noopener')
}
