import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { MessageChannel } from 'node:worker_threads'
import test from 'node:test'

const require = createRequire(import.meta.url)
let client
globalThis.window = {
  __ModuleLoader__: {
    load: ({ factory }) => { client = factory(require) },
  },
}
await import('../lib/client.js')

const {
  UiContainer,
  UiContainerRemoteClient,
  createMessagePortUiRemoteChannel,
  createWebSocketUiRemoteChannel,
  exposeUiContainerRemote,
} = client

const handshake = (capabilities) => ({
  client: { name: 'ui-test', version: '1.0.0', instance_id: 'test-client' },
  protocol_versions: [1],
  capabilities,
})

async function waitFor(predicate) {
  while (!predicate()) await new Promise((resolve) => setTimeout(resolve, 10))
}

class TestWebSocket {
  readyState = 1
  peer
  listeners = new Map()

  send(data) {
    queueMicrotask(() => this.peer?.emit('message', { data }))
  }

  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.emit('close', {})
    if (this.peer?.readyState !== 3) {
      this.peer.readyState = 3
      this.peer.emit('close', {})
    }
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function createWebSocketPair() {
  const first = new TestWebSocket()
  const second = new TestWebSocket()
  first.peer = second
  second.peer = first
  return [first, second]
}

function createRemote(container, capabilities) {
  const ports = new MessageChannel()
  const serverChannel = createMessagePortUiRemoteChannel(ports.port1)
  const clientChannel = createMessagePortUiRemoteChannel(ports.port2)
  const disposeServer = exposeUiContainerRemote(container, serverChannel, {
    server: { name: 'ui-host', version: '1.0.0', instance_id: 'test-server' },
    capabilities,
  })
  return {
    connect: (requested) => UiContainerRemoteClient.connect(clientChannel, handshake(requested)),
    close: () => {
      disposeServer()
      serverChannel.close()
      clientChannel.close()
    },
  }
}

test('projects remote documents and sends invalidations without document payloads', { timeout: 3_000 }, async (t) => {
  const host = new UiContainer()
  let snapshot = {
    uri: 'memory:item-1',
    title: 'First item',
    mediaType: 'text/markdown',
    kind: 'knowledge',
    revision: 'r1',
    content: '# First',
    metadata: { source: 'test' },
  }
  let resolveCount = 0
  const listeners = new Set()
  host.documents.registerProvider({
    scheme: 'memory',
    resolve: () => {
      resolveCount += 1
      return snapshot
    },
    subscribe: (_uri, _context, listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  })

  const remote = createRemote(host, ['documents', 'subscriptions'])
  t.after(remote.close)
  const client = await remote.connect(['documents', 'subscriptions'])
  t.after(() => client.dispose())
  assert.deepEqual(client.handshake.document_schemes, ['memory'])

  const provider = client.createDocumentProvider('memory')
  const context = { surfaceId: 'patchouli.memory', sessionId: 'session-1' }
  const first = await provider.resolve('memory:item-1', context, new AbortController().signal)
  assert.equal(first.content, '# First')
  assert.deepEqual(provider.describe?.('memory:item-1'), first)

  const cached = await provider.resolve('memory:item-1', context, new AbortController().signal)
  assert.strictEqual(cached, first)
  assert.equal(resolveCount, 2)

  let changed
  const change = new Promise((resolve) => { changed = resolve })
  const unsubscribe = provider.subscribe?.('memory:item-1', context, changed)
  await waitFor(() => listeners.size === 1)
  snapshot = { ...snapshot, revision: 'r2', content: '# Updated' }
  for (const listener of listeners) listener()
  await change

  const updated = await provider.resolve('memory:item-1', context, new AbortController().signal)
  assert.equal(updated.revision, 'r2')
  assert.equal(updated.content, '# Updated')
  unsubscribe?.()
  await waitFor(() => listeners.size === 0)
  assert.equal(listeners.size, 0)
})

test('keeps surface commands disabled unless both peers negotiate them', { timeout: 3_000 }, async (t) => {
  const host = new UiContainer()
  const surface = host.connectSurface({ id: 'patchouli.memory' })
  const calls = []
  surface.surface.registerSessionHost('session-1', {
    open: (document) => calls.push(['open', document.uri]),
    close: (uri) => calls.push(['close', uri]),
    reveal: (document) => calls.push(['reveal', document.uri]),
  })

  const remote = createRemote(host, ['documents', 'subscriptions'])
  t.after(remote.close)
  const client = await remote.connect(['surface_commands'])
  t.after(() => client.dispose())
  await assert.rejects(
    client.open('patchouli.memory', 'session-1', { uri: 'memory:item-1' }),
    /not negotiated/,
  )
  assert.deepEqual(calls, [])
})

test('routes explicitly enabled surface commands to the addressed session host', { timeout: 3_000 }, async (t) => {
  const host = new UiContainer()
  const surface = host.connectSurface({ id: 'patchouli.memory' })
  const calls = []
  surface.surface.registerSessionHost('session-1', {
    open: (document) => calls.push(['open', document.uri]),
    close: (uri) => calls.push(['close', uri]),
    reveal: (document) => calls.push(['reveal', document.uri]),
  })

  const remote = createRemote(host, ['surface_commands'])
  t.after(remote.close)
  const client = await remote.connect(['surface_commands'])
  t.after(() => client.dispose())
  await client.open('patchouli.memory', 'session-1', { uri: 'memory:item-1' })
  await client.reveal('patchouli.memory', 'session-1', { uri: 'memory:item-2' })
  await client.close('patchouli.memory', 'session-1', 'memory:item-1')
  assert.deepEqual(calls, [
    ['open', 'memory:item-1'],
    ['reveal', 'memory:item-2'],
    ['close', 'memory:item-1'],
  ])
})

test('releases server subscriptions when the process channel closes', { timeout: 3_000 }, async (t) => {
  const host = new UiContainer()
  const listeners = new Set()
  host.documents.registerProvider({
    scheme: 'memory',
    resolve: (uri) => ({ uri, content: 'item' }),
    subscribe: (_uri, _context, listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  })

  const remote = createRemote(host, ['documents', 'subscriptions'])
  t.after(remote.close)
  const client = await remote.connect(['documents', 'subscriptions'])
  const provider = client.createDocumentProvider('memory')
  provider.subscribe?.(
    'memory:item-1',
    { surfaceId: 'patchouli.memory', sessionId: 'session-1' },
    () => {},
  )
  await waitFor(() => listeners.size === 1)
  client.dispose()
  await waitFor(() => listeners.size === 0)
})

test('rejects document content that cannot cross a JSON network boundary', { timeout: 3_000 }, async (t) => {
  const host = new UiContainer()
  host.documents.registerProvider({
    scheme: 'invalid',
    resolve: (uri) => ({ uri, content: new Date() }),
  })

  const remote = createRemote(host, ['documents'])
  t.after(remote.close)
  const client = await remote.connect(['documents'])
  t.after(() => client.dispose())
  const provider = client.createDocumentProvider('invalid')
  await assert.rejects(
    provider.resolve(
      'invalid:item-1',
      { surfaceId: 'test', sessionId: 'test' },
      new AbortController().signal,
    ),
    /JSON-compatible/,
  )
})

test('runs the same protocol over JSON WebSocket frames', { timeout: 3_000 }, async (t) => {
  const host = new UiContainer()
  host.documents.registerProvider({
    scheme: 'memory',
    resolve: (uri) => ({ uri, revision: 'r1', content: { text: 'remote' } }),
  })
  const [serverSocket, clientSocket] = createWebSocketPair()
  const serverChannel = createWebSocketUiRemoteChannel(serverSocket)
  const clientChannel = createWebSocketUiRemoteChannel(clientSocket)
  const stopServing = exposeUiContainerRemote(host, serverChannel, {
    server: { name: 'ui-host', version: '1.0.0', instance_id: 'test-server' },
  })
  t.after(stopServing)
  const client = await UiContainerRemoteClient.connect(clientChannel, handshake(['documents']))
  t.after(() => client.dispose())
  const provider = client.createDocumentProvider('memory')
  const snapshot = await provider.resolve(
    'memory:item-1',
    { surfaceId: 'patchouli.memory', sessionId: 'session-1' },
    new AbortController().signal,
  )
  assert.deepEqual(snapshot.content, { text: 'remote' })
})
