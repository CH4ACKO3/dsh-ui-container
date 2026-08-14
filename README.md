# dsh-ui-container

Reusable visual and service container for DeepSeek Harness browser plugins. It
owns named UI surfaces, document providers, recursive React hosts, and the small
remote protocol needed to connect another frontend without transmitting a DOM
or component tree.

Install the plugin into a DeepSeek Harness profile:

```sh
dsh plugin --profile web add github:CH4ACKO3/dsh-ui-container
```

This command is profile-scoped and can be run from any directory.

Git dependencies run this package's `prepare` build. With pnpm 10 or newer,
approve the exact package key reported by the first install in the profile's
`pnpm-workspace.yaml`, then repeat the command. Registry releases and packed
artifacts do not require that approval.

Other browser plugins import its public API from
`@ch4acko3/dsh-ui-container/client` and inject the `uiContainer` Cordis service.

## Remote transport

`@ch4acko3/dsh-ui-container` can project a container across a process or
network boundary. The remote contract transfers document snapshots and change
notifications; it never transfers React elements, DOM nodes or a Cordis service
object.

## Capabilities

Protocol version 1 negotiates these capabilities during the mandatory
handshake:

- `documents` resolves URI-based document projections.
- `subscriptions` subscribes to a URI and sends a small invalidation when its
  projection may have changed.
- `surface_commands` routes open, reveal and close commands to a mounted surface
  session. A server must opt in to this capability; it is disabled by default.

Document resolution includes an optional `known_revision`. When it matches the
current server revision, the response is `not_modified` and contains no document
payload. A change notification contains only the subscription id and URI. The
client then resolves the document again, so network usage follows actual data
changes rather than the size or nesting of the rendered component tree.

All remote document content and metadata must be JSON-compatible. Renderers stay
inside the receiving frontend and render the projection locally.

## Cross-process connection

Use `MessagePort` for a Worker, iframe bridge or host IPC adapter:

```ts
const hostChannel = createMessagePortUiRemoteChannel(hostPort)
const clientChannel = createMessagePortUiRemoteChannel(clientPort)

const stopServing = exposeUiContainerRemote(ctx.uiContainer, hostChannel, {
  server: {
    name: 'patchouli-host',
    version: '0.1.0',
    instance_id: crypto.randomUUID(),
  },
})

const remote = await UiContainerRemoteClient.connect(clientChannel, {
  client: {
    name: 'patchouli-window',
    version: '0.1.0',
    instance_id: crypto.randomUUID(),
  },
  protocol_versions: [UI_REMOTE_PROTOCOL_VERSION],
  capabilities: ['documents', 'subscriptions'],
})

const unregister = ctx.uiContainer.documents.registerProvider(
  remote.createDocumentProvider('memory'),
)
```

Dispose `unregister`, `remote`, and `stopServing` with the lifecycle that owns
the ports.

## Network connection

The network owner accepts and authenticates the WebSocket first, then exposes
the container over that socket:

```ts
webSocketServer.on('connection', (socket, request) => {
  const principal = authenticate(request)
  if (!principal) return socket.close(1008, 'Unauthorized')

  const channel = createWebSocketUiRemoteChannel(socket)
  exposeUiContainerRemote(ctx.uiContainer, channel, {
    server: {
      name: 'patchouli-host',
      version: '0.1.0',
      instance_id: processInstanceId,
    },
    capabilities: ['documents', 'subscriptions'],
  })
})
```

A browser client can connect directly:

```ts
const remote = await connectUiContainerWebSocket('wss://host.example/ui', {
  client: {
    name: 'patchouli-web',
    version: '0.1.0',
    instance_id: crypto.randomUUID(),
  },
  protocol_versions: [UI_REMOTE_PROTOCOL_VERSION],
  capabilities: ['documents', 'subscriptions'],
})
```

The transport intentionally does not define authentication. The application
that owns the WebSocket endpoint must enforce authentication, authorization,
TLS and origin policy before calling `exposeUiContainerRemote`. A server should
enable `surface_commands` only for principals allowed to control the addressed
frontend session.

## Wire contract

Messages are JSON-RPC 2.0. Method names carry their major version:

```text
ui.container.handshake@1
ui.container.document.resolve@1
ui.container.document.subscribe@1
ui.container.document.unsubscribe@1
ui.container.document.changed@1       # server notification
ui.container.surface.open@1
ui.container.surface.reveal@1
ui.container.surface.close@1
```

The TypeScript definitions in `src/client/remote-protocol.ts` are the normative
wire schema. A connection permits exactly one handshake, and every later method
must belong to a negotiated capability.
