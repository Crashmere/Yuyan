import type { ImageSize, ImageSizes } from './api'

// The asset id in an image address such as /yuyan/assets/<id>.png.
export function assetId(src: string): string | null {
  return /\/assets\/([0-9a-f]{32})\./.exec(src)?.[1] ?? null
}

// How an image without a complete size gets its box before it loads: the stored proportions, plus
// its natural width when no size was written, which is how wide it shows once loaded. Images keep
// whatever size the document gives them.
export function reservedSize(natural: ImageSize | undefined, width: number | null, height: number | null): { width?: number; aspectRatio?: string } {
  if (!natural || (width && height)) return {}
  const [w, h] = natural
  if (!w || !h) return {}
  return { width: width || height ? undefined : w, aspectRatio: `${w} / ${h}` }
}

// Screens of 2 or more device pixels per CSS pixel get the versions listed for them, which may
// replace lossless versions of screenshots with JPEGs: compression they show pixel for pixel blends
// at that density. The ratio includes browser zoom.
const denseQuery = typeof matchMedia === 'function' ? matchMedia('(min-resolution: 2dppx), (-webkit-min-device-pixel-ratio: 2)') : undefined

export function denseScreen(): boolean {
  return denseQuery?.matches ?? false
}

// Calls listener when the window moves to a screen of the other kind, or zooms across 2x.
export function onDensityChange(listener: () => void) {
  denseQuery?.addEventListener('change', listener)
}

// The display versions of an image (internal/variants) as srcset candidates; the browser loads the
// narrowest one that covers the shown width at the screen's pixel density. A version such as
// "1280.jpg" sits next to the original as assets/<id>-1280.jpg, and the original stays the widest
// candidate unless a version is as wide. sizes="auto" takes the laid-out width and needs
// loading="lazy"; browsers without it use the estimate after it, which must not fall short, so an
// image in a frame (cropped, or placed on a board), which can be laid out wider than the frame,
// counts its whole picture.
export function displayVersions(src: string, size: ImageSize | undefined, written: number | null, framed: boolean, dense: boolean): { srcset: string; sizes: string } | null {
  const files = (dense && size?.[3]) || size?.[2]
  const stem = /^(.*\/assets\/[0-9a-f]{32})\.[a-z]+$/.exec(src)?.[1]
  if (!size || !files?.length || !stem) return null
  const candidates = files.map((file) => `${stem}-${file} ${parseInt(file)}w`)
  if (parseInt(files[files.length - 1]) < size[0]) candidates.push(`${src} ${size[0]}w`)
  const estimate = framed ? size[0] : Math.min(written || size[0], columnWidth())
  return { srcset: candidates.join(', '), sizes: `auto, ${estimate}px` }
}

let column = 0
function columnWidth(): number {
  column ||= parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--yy-content-width')) || 1100
  return Math.min(column, window.innerWidth)
}

interface Shown {
  size: ImageSize
  written: number | null
  framed: boolean
}

const known = new WeakMap<HTMLImageElement, Shown>()

// The original's size for a reading-page image. naturalWidth stops being that once a narrower
// version is shown: it reports the version's width divided by its density.
export function knownSize(img: HTMLImageElement): ImageSize | undefined {
  return known.get(img)?.size
}

export function reserveImageSpace(root: HTMLElement, sizes: ImageSizes) {
  for (const img of root.querySelectorAll<HTMLImageElement>('img')) {
    const id = assetId(img.getAttribute('src') ?? '')
    const size = id ? sizes[id] : undefined
    if (!size) continue
    const shown = { size, written: Number(img.getAttribute('width')) || null, framed: !!img.closest('[data-image-frame]') }
    known.set(img, shown)
    if (!shown.framed) {
      const r = reservedSize(size, shown.written, Number(img.getAttribute('height')) || null)
      if (r.width) img.setAttribute('width', String(r.width))
      if (r.aspectRatio) img.style.aspectRatio = r.aspectRatio
    }
    offerVersions(img, shown)
  }
}

function offerVersions(img: HTMLImageElement, shown: Shown) {
  const versions = displayVersions(img.getAttribute('src') ?? '', shown.size, shown.written, shown.framed, denseScreen())
  if (versions) {
    img.sizes = versions.sizes
    img.srcset = versions.srcset
  } else {
    img.removeAttribute('srcset')
    img.removeAttribute('sizes')
  }
}

onDensityChange(() => {
  for (const img of document.querySelectorAll('img')) {
    const shown = known.get(img)
    if (shown) offerVersions(img, shown)
  }
})

// Cancels the downloads of images still loading in a page that is being left. They would go on in
// the background, and over HTTP/1.1 the few connections a browser opens to one server then hold up
// the next page's requests.
export function stopLoading(root: Element) {
  for (const img of root.querySelectorAll('img')) {
    if (img.complete) continue
    img.removeAttribute('srcset')
    img.removeAttribute('src')
  }
}
