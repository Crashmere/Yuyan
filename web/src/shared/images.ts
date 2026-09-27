// The asset id in an image address such as /yuyan/assets/<id>.png.
export function assetId(src: string): string | null {
  return /\/assets\/([0-9a-f]{32})\./.exec(src)?.[1] ?? null
}

// How an image without a complete size gets its box before it loads: the stored proportions, plus
// its natural width when no size was written, which is how wide it shows once loaded. Images keep
// whatever size the document gives them.
export function reservedSize(natural: [number, number] | undefined, width: number | null, height: number | null): { width?: number; aspectRatio?: string } {
  if (!natural || (width && height)) return {}
  const [w, h] = natural
  if (!w || !h) return {}
  return { width: width || height ? undefined : w, aspectRatio: `${w} / ${h}` }
}

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
