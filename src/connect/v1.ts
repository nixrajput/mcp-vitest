import type { CallToolOptions, McpToolResult, RawConnection, SdkClientLike } from '../types.js'

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

  const listeners = new Set<(n: { method: string; params: unknown }) => void>()
  const emit = (method: string, params: unknown) => {
    for (const l of listeners) l({ method, params })
  }
  // Progress never reaches the fallback: both majors register a dedicated
  // handler for it at construction, so collectors are fed from callTool below.
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
    // v1 signature: callTool(params, resultSchema?, options?)
    callTool: async (params, opts?: CallToolOptions) =>
      (
        client as unknown as {
          callTool: (p: unknown, s: unknown, o: unknown) => Promise<McpToolResult>
        }
      ).callTool(params, undefined, {
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
      await connectable.close?.()
    },
  }
}
