// Shared by the static renderer and HTML export; the editor uses the theme-aware CSS equivalent.
export function imageFrame(value: unknown): Record<string, string> {
  return value === true ? { 'data-frame': 'shadow', style: 'box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.12)' } : {}
}
