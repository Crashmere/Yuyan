import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { port } from './instance'

// Starts the built program on an empty data directory, fills it with the synthetic sample data
// and returns the teardown that stops it and removes the data.
export default async function globalSetup() {
  const root = fileURLToPath(new URL('../..', import.meta.url))
  const bin = join(root, 'bin/yuyan')
  const dir = mkdtempSync(join(tmpdir(), 'yuyan-e2e-'))
  const data = join(dir, 'data')
  execFileSync(bin, ['init', '--data', data])
  const server = spawn(bin, ['serve', '--data', data, '--listen', `127.0.0.1:${port}`, '--with-prefix'], { stdio: 'inherit' })
  const base = `http://127.0.0.1:${port}/yuyan/`
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`${base}healthz`)).ok) break
    } catch {
      // not listening yet
    }
    if (attempt > 100) throw new Error('yuyan did not start; run `make build` first')
    await new Promise((r) => setTimeout(r, 100))
  }
  execFileSync(join(root, 'web/node_modules/.bin/tsx'), ['tools/demo/seed.ts', '--server', base], { cwd: join(root, 'web'), stdio: 'inherit' })
  return async () => {
    server.kill()
    rmSync(dir, { recursive: true, force: true })
  }
}
