import type { CallToolOptions, McpToolResult, RawConnection, SdkClientLike } from '../types.js'

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

  const listeners = new Set<(n: { method: string; params: unknown }) => void>()
  const emit = (method: string, params: unknown) => {
    for (const l of listeners) l({ method, params })
  }
  // list_changed-style notifications need subscriptions/listen under the 2026
  // lifecycle, which this harness does not open, so v2 collects progress only.
  ;(
    client as unknown as { fallbackNotificationHandler?: (n: unknown) => Promise<void> }
  ).fallbackNotificationHandler = async (n) => {
    const note = n as { method: string; params: unknown }
    emit(note.method, note.params)
  }

  let closed = false
  return {
    client: client as unknown as SdkClientLike,
    onNotification: (cb) => {
      listeners.add(cb)
    },
    // v2 dropped the resultSchema parameter: callTool(params, options?)
    callTool: async (params, opts?: CallToolOptions) =>
      (
        client as unknown as {
          callTool: (p: unknown, o: unknown) => Promise<McpToolResult>
        }
      ).callTool(params, {
        onprogress: (p: { progress: number; total?: number; message?: string }) => {
          emit('notifications/progress', p)
          opts?.onProgress?.(p)
        },
        signal: opts?.signal,
        timeout: opts?.timeoutMs,
      }),
    close: async () => {
      if (closed) return
      closed = true
      await client.close()
      await handler.close()
    },
  }
}
