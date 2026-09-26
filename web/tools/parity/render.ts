// Renders the parity fixtures with Tiptap's static renderer. internal/render compares its own
// output against these snapshots, so both renderers stay in step.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToHTMLString } from '@tiptap/static-renderer/pm/html-string'
import { schemaExtensions } from '../../src/schema/extensions'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '../../test/fixtures')
const out = join(here, '../../../internal/render/testdata')
mkdirSync(out, { recursive: true })

const extensions = schemaExtensions()
for (const file of readdirSync(fixtures).filter((f) => f.endsWith('.json')).sort()) {
  const content = JSON.parse(readFileSync(join(fixtures, file), 'utf8'))
  const html = renderToHTMLString({ content, extensions })
  writeFileSync(join(out, file.replace(/\.json$/, '.html')), html + '\n')
  console.log('rendered', file)
}
