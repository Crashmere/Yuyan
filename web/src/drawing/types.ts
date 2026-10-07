// Persisted envelope shared by the browser adapter and portable import/export.
// Scene elements stay in Excalidraw's native format; this is not another graph model.
export interface DrawingPackage {
  format: 'yuyan-drawing'
  version: 1
  engine: 'excalidraw'
  engineVersion: '0.18.1'
  scene: { elements: readonly Record<string, any>[]; appState: { viewBackgroundColor: string } }
  files: Record<string, { src: string; mimeType: string }>
  preview: { mime: 'image/svg+xml' | 'image/png'; data: string; width: number; height: number }
  sceneHash?: string
  text?: string
}
