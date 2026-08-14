import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sourceRoot = '../src/client/'

test('exposes an isolated connection for each frontend surface', async () => {
  const documents = await readFile(new URL(`${sourceRoot}documents.ts`, import.meta.url), 'utf8')

  assert.match(documents, /class UiContainer/)
  assert.match(documents, /connectSurface\(descriptor: UiSurfaceDescriptor\)/)
  assert.match(documents, /class UiSurfaceConnection/)
  assert.match(documents, /surfaceId: this\.id/)
  assert.match(documents, /subscribeDocument/)
  assert.match(documents, /UI surface already connected/)
})

test('provides a recursive browser-local visual surface host', async () => {
  const host = await readFile(new URL(`${sourceRoot}SurfaceHost.tsx`, import.meta.url), 'utf8')

  assert.match(host, /createContext<UiSurfaceContextValue \| null>/)
  assert.match(host, /surface \?\? parent\?\.surface/)
  assert.match(host, /sessionId \?\? parent\?\.sessionId/)
  assert.match(host, /data-ui-surface-path/)
})

test('does not couple the container to Workspace or Harness view slots', async () => {
  const entry = await readFile(new URL(`${sourceRoot}index.ts`, import.meta.url), 'utf8')

  assert.doesNotMatch(entry, /DocumentSurface|ExplorerPaneStack|conversation\.view/)
})

test('ships an independently installable DSH client bundle', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const host = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
  const client = await readFile(new URL(`${sourceRoot}index.ts`, import.meta.url), 'utf8')

  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(packageJson.dsh.client.inject, ['@deepseek-ai/dsh-client-runtime'])
  assert.equal(packageJson.exports['.'].default, './lib/index.js')
  assert.equal(packageJson.exports['./client'].default, './lib/client.js')
  assert.match(patch, /id: ch4acko3-ui-container/)
  assert.match(patch, /name: '@ch4acko3\/dsh-ui-container'/)
  assert.match(host, /export function apply\(\): void/)
  assert.match(client, /ctx\.provide\('uiContainer'/)
})
