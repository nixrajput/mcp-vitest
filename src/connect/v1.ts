import type { McpToolResult, RawConnection, SdkClientLike } from '../types.js'
import { createNotificationBus } from './bus.js'

// v1 servers use the 2025-era stateful lifecycle; InMemoryTransport is the
// SDK-blessed in-process path for it (see SDK docs/testing.md).
export async function connectV1(server: unknown): Promise<RawConnection> {
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'mcp-vitest', version: '0.1.0' })

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
      closed = true
      await client.close()
      await connectable.close?.()
    },
  }
}
