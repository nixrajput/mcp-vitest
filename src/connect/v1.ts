import type { DoubleRegistry } from '../doubles.js'
import type { McpToolResult, RawConnection, SdkClientLike } from '../types.js'
import { createNotificationBus } from './bus.js'

// v1 servers use the 2025-era stateful lifecycle; InMemoryTransport is the
// SDK-blessed in-process path for it (see SDK docs/testing.md).
export async function connectV1(server: unknown, registry: DoubleRegistry): Promise<RawConnection> {
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  // Capabilities are advertised unconditionally: a server decides what to request
  // during initialize, long before a test body can register its doubles.
  const client = new Client(
    { name: 'mcp-vitest', version: '0.1.0' },
    { capabilities: { sampling: {}, elicitation: {}, roots: { listChanged: true } } },
  )

  const { CreateMessageRequestSchema, ElicitRequestSchema, ListRootsRequestSchema } = await import(
    '@modelcontextprotocol/sdk/types.js'
  )
  client.setRequestHandler(
    CreateMessageRequestSchema,
    async (req) => registry.requireSampling()(req.params as never) as never,
  )
  client.setRequestHandler(
    ElicitRequestSchema,
    async (req) => registry.requireElicitation()(req.params as never) as never,
  )
  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: registry.requireRoots(),
  }))

  const connectable = server as {
    connect(t: unknown): Promise<void>
    close?(): Promise<void>
  }
  await Promise.all([connectable.connect(serverTransport), client.connect(clientTransport)])

  const bus = createNotificationBus(client)

  let closed = false
  return {
    client: client as unknown as SdkClientLike,
    onNotification: bus.onNotification,
    // v1 signature: callTool(params, resultSchema?, options?)
    callTool: async (params, opts) =>
      (
        client as unknown as {
          callTool: (p: unknown, s: unknown, o: unknown) => Promise<McpToolResult>
        }
      ).callTool(params, undefined, bus.requestOptions(opts)),
    close: async () => {
      if (closed) return
      // The server must be closed even if the client transport is already gone,
      // and `closed` flips only on success so a caller can retry teardown.
      try {
        await client.close()
      } finally {
        await connectable.close?.()
        closed = true
      }
    },
  }
}
