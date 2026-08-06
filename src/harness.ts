import { connectV1 } from './connect/v1.js'
import { connectV2 } from './connect/v2.js'
import { detectServerKind, type ServerKind } from './detect.js'
import { NotificationCollector } from './notifications.js'
import {
  type CallToolOptions,
  type McpServerInput,
  type McpTestOptions,
  type McpToolResult,
  type RawConnection,
  type SdkClientLike,
  TOOL_META,
  type ToolCallMeta,
} from './types.js'

export class McpHarness {
  constructor(
    readonly kind: ServerKind,
    private readonly conn: RawConnection,
  ) {}

  /** @internal fed by mcpTest()'s connection listener */
  readonly collectors: NotificationCollector[] = []

  get client(): SdkClientLike {
    return this.conn.client
  }

  notifications(method?: string): NotificationCollector {
    const collector = new NotificationCollector(method)
    this.collectors.push(collector)
    return collector
  }

  async listTools() {
    const tools: Awaited<ReturnType<SdkClientLike['listTools']>>['tools'] = []
    let cursor: string | undefined
    do {
      const page = await this.conn.client.listTools(cursor ? { cursor } : undefined)
      tools.push(...page.tools)
      cursor = page.nextCursor
    } while (cursor)
    return tools
  }

  async callTool(
    name: string,
    args?: Record<string, unknown>,
    opts?: CallToolOptions,
  ): Promise<McpToolResult> {
    // Only ask the SDK for progress when someone is listening: it attaches
    // _meta.progressToken whenever onprogress is set, and servers branch on it.
    const wantsProgress = opts?.onProgress ?? (this.collectors.length > 0 ? () => {} : undefined)
    const result = await this.conn.callTool(
      { name, arguments: args },
      { ...opts, onProgress: wantsProgress },
    )
    // Carries the tool's declared outputSchema to toMatchOutputSchema() without
    // widening the public result shape. Non-enumerable so snapshots ignore it.
    Object.defineProperty(result, TOOL_META, {
      value: {
        toolName: name,
        outputSchema: (await this.toolEntry(name))?.outputSchema as
          | Record<string, unknown>
          | undefined,
      } satisfies ToolCallMeta,
      enumerable: false,
      // Redefinable: an SDK that hands back a cached result object would
      // otherwise throw on the second call.
      configurable: true,
    })
    return result
  }

  private toolIndex?: Map<string, Awaited<ReturnType<McpHarness['listTools']>>[number]>

  // Best effort: a tools/list that fails, or a tool registered after the index
  // was built, must not turn a successful tools/call into a rejection.
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
    const resources: Awaited<ReturnType<SdkClientLike['listResources']>>['resources'] = []
    let cursor: string | undefined
    do {
      const page = await this.conn.client.listResources(cursor ? { cursor } : undefined)
      resources.push(...page.resources)
      cursor = page.nextCursor
    } while (cursor)
    return resources
  }

  async listPrompts() {
    const prompts: Awaited<ReturnType<SdkClientLike['listPrompts']>>['prompts'] = []
    let cursor: string | undefined
    do {
      const page = await this.conn.client.listPrompts(cursor ? { cursor } : undefined)
      prompts.push(...page.prompts)
      cursor = page.nextCursor
    } while (cursor)
    return prompts
  }

  async getPrompt(name: string, args?: Record<string, string>) {
    return this.conn.client.getPrompt({ name, arguments: args })
  }

  async close(): Promise<void> {
    // Drop pending waiters first: their timers would otherwise fire after the
    // test ends and vitest would blame whichever test runs next.
    for (const c of this.collectors) c.dispose()
    await this.conn.close()
  }
}

async function resolveInput(
  input: McpServerInput,
): Promise<{ kind: ServerKind; conn: RawConnection }> {
  if (typeof input === 'function') {
    const factory = input as () => unknown | Promise<unknown>
    const probe = await factory()
    const kind = await detectServerKind(probe)
    if (kind === 'v2') {
      // v2 handlers create a fresh server per request; hand the factory over.
      return { kind, conn: await connectV2(factory) }
    }
    return { kind, conn: await connectV1(probe) }
  }
  const kind = await detectServerKind(input)
  if (kind === 'v2') {
    return { kind, conn: await connectV2(() => input) }
  }
  return { kind, conn: await connectV1(input) }
}

export async function mcpTest(
  input: McpServerInput,
  options: McpTestOptions = {},
): Promise<McpHarness> {
  const { kind, conn } = await resolveInput(input)
  const harness = new McpHarness(kind, conn)
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
