// An explicit build entry used by yuyan-doc in an isolated local browser. It uses
// the same engine and publisher as interactive editing, with no production write.
import { buildPackage, engineLibrary, type SceneDraft } from './engine'
import { templateSkeleton } from './templates'

export async function generate(spec: { template?: string; elements?: Record<string, unknown>[]; files?: SceneDraft['files']; background?: string }) {
  if (!!spec.template === !!spec.elements) throw new Error('指定 template 或 elements 其中之一')
  const lib = await engineLibrary()
  const skeleton = spec.template ? templateSkeleton(spec.template) : spec.elements!
  if (!Array.isArray(skeleton) || !skeleton.length || skeleton.length > 10000) throw new Error('需要 1–10000 个图形元素')
  const elements = lib.convertToExcalidrawElements(skeleton.map(e => ({ roughness: 0, fillStyle: 'solid', strokeWidth: 1, fontFamily: 2, ...e })) as any, { regenerateIds: false })
  return buildPackage({ elements, appState: { viewBackgroundColor: spec.background || '#ffffff' }, files: spec.files || {} })
}
