import type { McpHarness } from './harness.js'

// Snapshots must not churn on key order or absent optionals. `_meta` is dropped
// only from the entry itself: servers attach it there, while a nested _meta is
// the user's own schema property and a real change worth catching.
function normalize(value: unknown, dropMeta = false): unknown {
  if (Array.isArray(value)) return value.map((v) => normalize(v, dropMeta))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as object).sort()) {
      if (dropMeta && key === '_meta') continue
      const v = (value as Record<string, unknown>)[key]
      if (v === undefined) continue
      out[key] = normalize(v)
    }
    return out
  }
  return value
}

function normalizeEntries(entries: unknown[]): unknown {
  return entries.map((e) => normalize(e, true))
}

// A server that does not advertise a capability answers -32601 (or, on v1, an
// assertCapability error); for a manifest "this server exposes none" is the
// honest answer. Anything else is a real failure and must not be swallowed into
// an empty manifest that snapshots green.
function isUnsupportedCapability(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const code = (error as { code?: unknown })?.code
  return code === -32601 || /-32601|method not found|does not support/i.test(message)
}

async function orEmpty<T>(list: Promise<T[]>): Promise<T[]> {
  try {
    return await list
  } catch (error) {
    if (isUnsupportedCapability(error)) return []
    throw error
  }
}

export async function toolManifest(mcp: McpHarness): Promise<unknown> {
  const tools = await orEmpty(mcp.listTools())
  return normalizeEntries([...tools].sort((a, b) => a.name.localeCompare(b.name)))
}

export async function resourceManifest(mcp: McpHarness): Promise<unknown> {
  const resources = await orEmpty(mcp.listResources())
  return normalizeEntries([...resources].sort((a, b) => a.uri.localeCompare(b.uri)))
}

export async function promptManifest(mcp: McpHarness): Promise<unknown> {
  const prompts = await orEmpty(mcp.listPrompts())
  return normalizeEntries([...prompts].sort((a, b) => a.name.localeCompare(b.name)))
}

export async function capabilitiesManifest(mcp: McpHarness): Promise<unknown> {
  const [tools, resources, prompts] = await Promise.all([
    orEmpty(mcp.listTools()),
    orEmpty(mcp.listResources()),
    orEmpty(mcp.listPrompts()),
  ])
  return {
    tools: tools.map((t) => t.name).sort(),
    resources: resources.map((r) => r.uri).sort(),
    prompts: prompts.map((p) => p.name).sort(),
  }
}
