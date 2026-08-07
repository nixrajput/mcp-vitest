import type { DoubleRegistry, ElicitationRequest, SamplingRequest } from '../doubles.js'
import type { McpLifecycle, McpToolResult, RawConnection, SdkClientLike } from '../types.js'
import { createNotificationBus } from './bus.js'

// v2 in-process route per SDK docs/testing.md: createMcpHandler gives a
// fetch-style handler, and the client transport's fetch is pointed at it. It is
// the only in-process route that CAN reach the 2026-07-28 stateless lifecycle,
// but reaching it takes the pin below: versionNegotiation defaults to 'legacy',
// which negotiates 2025-11-25 over exactly the same plumbing.
const DEFAULT_LIFECYCLE: McpLifecycle = '2026-07-28'

export async function connectV2(
  createServer: () => unknown | Promise<unknown>,
  registry: DoubleRegistry,
  lifecycle: McpLifecycle = DEFAULT_LIFECYCLE,
): Promise<RawConnection> {
  const { createMcpHandler } = await import('@modelcontextprotocol/server')
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client')

  const handler = createMcpHandler(createServer as never)
  const transport = new StreamableHTTPClientTransport(new URL('http://mcp-vitest.test/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  })
  // Pinned, not 'auto': auto falls back to legacy when the probe is inconclusive,
  // and a silent downgrade would turn every double into a confusing timeout.
  const client = new Client(
    { name: 'mcp-vitest', version: '0.3.0' },
    {
      capabilities: { sampling: {}, elicitation: {} },
      versionNegotiation: {
        mode: lifecycle === '2026-07-28' ? { pin: lifecycle } : 'legacy',
      },
    },
  )
  // Server-initiated requests arrive as input_required results; the client's own
  // driver dispatches them here and retries the call (autoFulfill, maxRounds 10).
  client.setRequestHandler('sampling/createMessage', async (req) => {
    const result = await registry.requireSampling()(req.params as unknown as SamplingRequest)
    return result as unknown as never
  })
  client.setRequestHandler('elicitation/create', async (req) => {
    const result = await registry.requireElicitation()(req.params as unknown as ElicitationRequest)
    return result as unknown as never
  })
  await client.connect(transport)

  // list_changed-style notifications need subscriptions/listen under the 2026
  // lifecycle, which this harness does not open, so v2 collects progress only.
  const bus = createNotificationBus(client)

  let closed = false
  return {
    client: client as unknown as SdkClientLike,
    onNotification: bus.onNotification,
    lifecycle,
    // v2 dropped the resultSchema parameter: callTool(params, options?)
    callTool: async (params, opts) =>
      (
        client as unknown as {
          callTool: (p: unknown, o: unknown) => Promise<McpToolResult>
        }
      ).callTool(params, bus.requestOptions(opts)),
    close: async () => {
      if (closed) return
      // The handler must be closed even if the client transport is already gone,
      // and `closed` flips only on success so a caller can retry teardown.
      try {
        await client.close()
      } finally {
        await handler.close()
        closed = true
      }
    },
  }
}
