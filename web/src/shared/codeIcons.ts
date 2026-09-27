// Shared by the DOM reading controls and the editor's Vue node view.
export const codeIcons = {
  copy: 'M9 9h12v12H9zM5 15H3V3h12v2',
  wrap: 'M4 6h16M4 11h12a4 4 0 0 1 0 8h-4m3-3-3 3 3 3M4 17h3',
  check: 'm5 12 4 4L19 6',
} as const

export function codeIcon(name: keyof typeof codeIcons): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '15', height: '15', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value)
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', codeIcons[name])
  svg.appendChild(path)
  return svg
}
