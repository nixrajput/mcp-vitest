import type { McpToolResult, RawConnection, SdkClientLike } from '../types.js'
import { createNotificationBus } from './bus.js'

// v2 in-process route per SDK docs/testing.md: createMcpHandler gives a
// fetch-style handler, and the client transport's fetch is pointed at it.
// This is the only in-process path that exercises the 2026-07-28 stateless
// lifecycle (InMemoryTransport is 2025-era only).
export async function connectV2(
  createServer: () => unknown | Promise<unknown>,
): Promise<RawConnection> {
  const { createMcpHandler } = await import('@modelcontextprotocol/server')
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client')

  const handler = createMcpHandler(createServer as never)
  const transport = new StreamableHTTPClientTransport(new URL('http://mcp-vitest.test/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  })
  const client = new Client({ name: 'mcp-vitest', version: '0.1.0' })
  await client.connect(transport)

  // list_changed-style notifications need subscriptions/listen under the 2026
  // lifecycle, which this harness does not open, so v2 collects progress only.
  const bus = createNotificationBus(client)

  let closed = false
  return {
    client: client as unknown as SdkClientLike,
    onNotification: bus.onNotification,
    // v2 dropped the resultSchema parameter: callTool(params, options?)
    callTool: async (params, opts) =>
      (
        client as unknown as {
          callTool: (p: unknown, o: unknown) => Promise<McpToolResult>
        }
      ).callTool(params, bus.requestOptions(opts)),
    close: async () => {
      if (closed) return
      closed = true
      await client.close()
      await handler.close()
    },
  }
}
