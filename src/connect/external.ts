import type { DoubleRegistry, ElicitationRequest, SamplingRequest } from '../doubles.js'
import type {
  McpLifecycle,
  McpToolResult,
  RawConnection,
  SdkClientLike,
  StdioServerSpec,
  UrlServerSpec,
} from '../types.js'
import { CLIENT_INFO } from '../types.js'
import { createNotificationBus } from './bus.js'

/**
 * Spawns a server and speaks MCP over its stdio pipes. The v1 client is used
 * deliberately: external servers are the deployed fleet, and v1 speaks the widest
 * range of revisions those servers actually implement.
 */
export async function connectStdio(
  spec: StdioServerSpec,
  registry: DoubleRegistry,
  lifecycle?: McpLifecycle,
): Promise<RawConnection> {
  // The same ceiling and the same refusal as connectV1: this is the v1 client,
  // which tops out at 2025-11-25. Accepting '2026-07-28' here would connect at
  // 2025-11-25 anyway and let a lifecycle matrix print a revision it never ran.
  if (lifecycle === '2026-07-28') {
    throw new Error(
      'mcp-vitest: a stdio server is driven by the v1 SDK, which cannot serve the ' +
        "2026-07-28 lifecycle; it negotiates 2025-11-25. Drop '2026-07-28' from " +
        'lifecycles, or reach the server over { url } instead.',
    )
  }
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')

  const transport = new StdioClientTransport({
    command: spec.command,
    args: spec.args,
    env: spec.env,
    cwd: spec.cwd,
  })
  // Same capability advertisement and handler wiring as the in-process v1 lane:
  // a spawned server is still a v1 server, so doubles and notifications work
  // across the pipe rather than being stubbed out.
  const client = new Client(CLIENT_INFO, {
    capabilities: { sampling: {}, elicitation: {}, roots: {} },
  })

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

  const bus = createNotificationBus(client)
  await client.connect(transport)

  let closed = false
  return {
    client: client as unknown as SdkClientLike,
    onNotification: bus.onNotification,
    lifecycle,
    supports: { roots: true, serverInitiatedRequests: true },
    callTool: async (params, opts) =>
      (
        client as unknown as {
          callTool: (p: unknown, s: unknown, o: unknown) => Promise<McpToolResult>
        }
      ).callTool(params, undefined, bus.requestOptions(opts)),
    close: async () => {
      if (closed) return
      // Closing the client closes the transport, which terminates the child.
      // `closed` flips only on success so a caller can retry teardown.
      await client.close()
      closed = true
    },
  }
}

/**
 * Connects to an already-running server over Streamable HTTP. Unlike the
 * in-process v2 lane this does NOT pin the 2026 revision: the server belongs to
 * someone else and may implement any era, so negotiation probes by default and
 * meets it where it is. Pass `protocolVersion` to hold it to one instead.
 */
export async function connectUrl(
  spec: UrlServerSpec,
  registry: DoubleRegistry,
  lifecycle?: McpLifecycle,
): Promise<RawConnection> {
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client')

  const transport = new StreamableHTTPClientTransport(new URL(spec.url), {
    requestInit: spec.headers ? { headers: spec.headers } : undefined,
  })
  const client = new Client(CLIENT_INFO, {
    capabilities: { sampling: {}, elicitation: {} },
    versionNegotiation: {
      mode:
        lifecycle === undefined
          ? 'auto'
          : lifecycle === '2026-07-28'
            ? { pin: lifecycle }
            : 'legacy',
    },
  })
  client.setRequestHandler('sampling/createMessage', async (req) => {
    const result = await registry.requireSampling()(req.params as unknown as SamplingRequest)
    return result as unknown as never
  })
  client.setRequestHandler('elicitation/create', async (req) => {
    const result = await registry.requireElicitation()(req.params as unknown as ElicitationRequest)
    return result as unknown as never
  })

  const bus = createNotificationBus(client)
  await client.connect(transport)

  let closed = false
  return {
    client: client as unknown as SdkClientLike,
    onNotification: bus.onNotification,
    lifecycle,
    // No roots: connectUrl advertises no roots capability and registers no
    // roots/list handler, so onRoots must be refused rather than stored.
    // Doubles are always accepted here. Whether a remote server can issue
    // server-to-client requests depends on the server, not on the revision: a
    // v1-backed HTTP server pushes fine on the 2025 era, while a stateless v2
    // one cannot. Guessing from the era refuses working setups. And the guard
    // exists to prevent a stall, which does not happen on this lane - a server
    // that cannot ask fails in about 3 ms with a message naming the reason.
    supports: { roots: false, serverInitiatedRequests: true },
    callTool: async (params, opts) =>
      (
        client as unknown as {
          callTool: (p: unknown, o: unknown) => Promise<McpToolResult>
        }
      ).callTool(params, bus.requestOptions(opts)),
    close: async () => {
      if (closed) return
      await client.close()
      closed = true
    },
  }
}
