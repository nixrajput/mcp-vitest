import { connectStdio, connectUrl } from './connect/external.js'
import { connectV1 } from './connect/v1.js'
import { connectV2 } from './connect/v2.js'
import { detectServerKind, type ServerKind } from './detect.js'
import {
  DoubleRegistry,
  type ElicitationDouble,
  type ElicitationResult,
  type Root,
  type SamplingDouble,
} from './doubles.js'
import { NotificationCollector } from './notifications.js'
import {
  type CallToolOptions,
  type CompletionArgument,
  type CompletionRef,
  type CompletionResult,
  isStdioServerSpec,
  isUrlServerSpec,
  type McpLifecycle,
  type McpServerInput,
  type McpTestOptions,
  type McpToolResult,
  type RawConnection,
  type SdkClientLike,
  TOOL_META,
  type ToolCallMeta,
} from './types.js'

const MAX_PAGES = 1000

/** A stalled or repeating cursor fails loudly rather than spinning the worker forever. */
async function collectPages<Page extends { nextCursor?: string }, Item>(
  fetch: (cursor?: { cursor: string }) => Promise<Page>,
  items: (page: Page) => Item[],
  method: string,
): Promise<Item[]> {
  const out: Item[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      throw new Error(
        `mcp-vitest: ${method} exceeded ${MAX_PAGES} pages; pagination is not converging`,
      )
    }
    const result = await fetch(cursor ? { cursor } : undefined)
    out.push(...items(result))
    cursor = result.nextCursor
    if (cursor === undefined) return out
    if (seen.has(cursor)) {
      throw new Error(
        `mcp-vitest: ${method} repeated cursor ${JSON.stringify(cursor)}; pagination is stuck`,
      )
    }
    seen.add(cursor)
  }
}

export class McpHarness {
  // Required, not defaulted: a default registry is one the connection never reads.
  constructor(
    readonly kind: ServerKind,
    private readonly conn: RawConnection,
    private readonly registry: DoubleRegistry,
  ) {}

  /** @internal fed by mcpTest()'s connection listener */
  readonly collectors: NotificationCollector[] = []

  get client(): SdkClientLike {
    return this.conn.client
  }

  /** The revision this connection was pinned to; undefined when auto-negotiated. */
  get lifecycle(): McpLifecycle | undefined {
    return this.conn.lifecycle
  }

  /** Refuses a double the connection could never deliver, which would otherwise stall. */
  private assertCanServeDoubles(method: string): void {
    if (this.conn.supports.serverInitiatedRequests) return
    throw new Error(
      `mcp-vitest: ${method}() needs a connection that can carry server-initiated ` +
        `requests, and this one is held to ${this.lifecycle}. Hold it to '2026-07-28' ` +
        `instead, or use the in-process v1 lane or a spawned stdio server.`,
    )
  }

  /** Answers the server's sampling requests. */
  onSampling(double: SamplingDouble): void {
    this.assertCanServeDoubles('onSampling')
    this.registry.sampling = double
  }

  /** Answers the server's elicitation requests. A plain result becomes a constant double. */
  onElicitation(double: ElicitationDouble | ElicitationResult): void {
    this.assertCanServeDoubles('onElicitation')
    this.registry.elicitation = typeof double === 'function' ? double : () => double
  }

  /** Serves the server's roots/list requests. Not every lane advertises roots. */
  onRoots(roots: Root[]): void {
    // Asks the lane rather than inferring from `kind`, which missed a lane before.
    if (!this.conn.supports.roots) {
      throw new Error(
        'mcp-vitest: this connection does not advertise the roots capability, so a roots ' +
          'double would never be read. Roots is deprecated in the 2026-07-28 spec; it is ' +
          'served on the in-process v1 lane and on a spawned stdio server.',
      )
    }
    this.registry.roots = roots
  }

  notifications(method?: string): NotificationCollector {
    const collector = new NotificationCollector(method)
    this.collectors.push(collector)
    return collector
  }

  async listTools() {
    return collectPages(
      (cursor) => this.conn.client.listTools(cursor),
      (p) => p.tools,
      'tools/list',
    )
  }

  async callTool(
    name: string,
    args?: Record<string, unknown>,
    opts?: CallToolOptions,
  ): Promise<McpToolResult> {
    // The SDK attaches _meta.progressToken whenever onprogress is set and servers
    // branch on it, so only ask for progress when someone can receive it.
    const collecting = this.collectors.some((c) => c.wantsProgress)
    const wantsProgress = opts?.onProgress ?? (collecting ? () => {} : undefined)
    const result = await this.conn.callTool(
      { name, arguments: args },
      { ...opts, onProgress: wantsProgress },
    )
    // Carries the declared outputSchema to toMatchOutputSchema() without widening the
    // result shape. Non-enumerable so snapshots ignore it; best effort so a frozen
    // result cannot fail the call.
    try {
      Object.defineProperty(result, TOOL_META, {
        value: {
          toolName: name,
          outputSchema: (await this.toolEntry(name))?.outputSchema as
            | Record<string, unknown>
            | undefined,
        } satisfies ToolCallMeta,
        enumerable: false,
        configurable: true,
      })
    } catch {
      // non-extensible result: toMatchOutputSchema() needs an explicit schema
    }
    return result
  }

  private toolIndex?: Map<string, Awaited<ReturnType<McpHarness['listTools']>>[number]>

  // A failed tools/list must not turn a successful tools/call into a rejection.
  private async toolEntry(name: string) {
    try {
      if (!this.toolIndex) {
        this.toolIndex = new Map((await this.listTools()).map((t) => [t.name, t]))
      }
      if (!this.toolIndex.has(name)) {
        this.toolIndex = new Map((await this.listTools()).map((t) => [t.name, t]))
      }
      return this.toolIndex.get(name)
    } catch {
      return undefined
    }
  }

  async readResource(uri: string) {
    return this.conn.client.readResource({ uri })
  }

  async listResources() {
    return collectPages(
      (cursor) => this.conn.client.listResources(cursor),
      (p) => p.resources,
      'resources/list',
    )
  }

  async listPrompts() {
    return collectPages(
      (cursor) => this.conn.client.listPrompts(cursor),
      (p) => p.prompts,
      'prompts/list',
    )
  }

  async getPrompt(name: string, args?: Record<string, string>) {
    return this.conn.client.getPrompt({ name, arguments: args })
  }

  async complete(ref: CompletionRef, argument: CompletionArgument): Promise<CompletionResult> {
    return this.conn.client.complete({ ref, argument })
  }

  async close(): Promise<void> {
    // Drop waiters first, or their timers fire against whichever test runs next.
    for (const c of this.collectors) c.dispose()
    await this.conn.close()
  }
}

async function resolveInput(
  input: McpServerInput,
  registry: DoubleRegistry,
  lifecycle?: McpLifecycle,
): Promise<{ kind: ServerKind; conn: RawConnection }> {
  // Routed by shape first: a spec object is not an SDK instance to detect.
  if (isStdioServerSpec(input)) {
    return { kind: 'external', conn: await connectStdio(input, registry, lifecycle) }
  }
  if (isUrlServerSpec(input)) {
    return { kind: 'external', conn: await connectUrl(input, registry, lifecycle) }
  }
  if (typeof input === 'function') {
    const factory = input as () => unknown | Promise<unknown>
    const probe = await factory()
    const kind = await detectServerKind(probe)
    if (kind === 'v2') {
      // v2 handlers create a fresh server per request; hand the factory over.
      return { kind, conn: await connectV2(factory, registry, lifecycle) }
    }
    return { kind, conn: await connectV1(probe, registry, lifecycle) }
  }
  const kind = await detectServerKind(input)
  if (kind === 'v2') {
    return { kind, conn: await connectV2(() => input, registry, lifecycle) }
  }
  return { kind, conn: await connectV1(input, registry, lifecycle) }
}

export async function mcpTest(
  input: McpServerInput,
  options: McpTestOptions = {},
): Promise<McpHarness> {
  const registry = new DoubleRegistry()
  const { kind, conn } = await resolveInput(input, registry, options.protocolVersion)
  const harness = new McpHarness(kind, conn, registry)
  conn.onNotification((n) => {
    for (const c of harness.collectors) c.push(n.method, n.params)
  })
  if (options.autoClose !== false) {
    try {
      const { onTestFinished } = await import('vitest')
      onTestFinished(() => harness.close())
    } catch {
      // outside a vitest test context - caller owns close()
    }
  }
  return harness
}
