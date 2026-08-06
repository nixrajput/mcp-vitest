import { connectV1 } from './connect/v1.js'
import { connectV2 } from './connect/v2.js'
import { detectServerKind, type ServerKind } from './detect.js'
import type {
  McpServerInput,
  McpTestOptions,
  McpToolResult,
  RawConnection,
  SdkClientLike,
} from './types.js'

export class McpHarness {
  constructor(
    readonly kind: ServerKind,
    private readonly conn: RawConnection,
  ) {}

  get client(): SdkClientLike {
    return this.conn.client
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

  async callTool(name: string, args?: Record<string, unknown>): Promise<McpToolResult> {
    return this.conn.client.callTool({ name, arguments: args })
  }

  async close(): Promise<void> {
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
