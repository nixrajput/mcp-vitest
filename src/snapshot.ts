import type { McpHarness } from './harness.js'

// Snapshots must not churn on key order, absent optionals, or server-added _meta.
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as object).sort()) {
      if (key === '_meta') continue
      const v = (value as Record<string, unknown>)[key]
      if (v === undefined) continue
      out[key] = normalize(v)
    }
    return out
  }
  return value
}

export async function toolManifest(mcp: McpHarness): Promise<unknown> {
  const tools = await mcp.listTools()
  return normalize([...tools].sort((a, b) => a.name.localeCompare(b.name)))
}

export async function resourceManifest(mcp: McpHarness): Promise<unknown> {
  const resources = await mcp.listResources()
  return normalize([...resources].sort((a, b) => a.uri.localeCompare(b.uri)))
}

export async function promptManifest(mcp: McpHarness): Promise<unknown> {
  const prompts = await mcp.listPrompts()
  return normalize([...prompts].sort((a, b) => a.name.localeCompare(b.name)))
}

export async function capabilitiesManifest(mcp: McpHarness): Promise<unknown> {
  const [tools, resources, prompts] = await Promise.all([
    mcp.listTools(),
    mcp.listResources(),
    mcp.listPrompts(),
  ])
  return {
    tools: tools.map((t) => t.name).sort(),
    resources: resources.map((r) => r.uri).sort(),
    prompts: prompts.map((p) => p.name).sort(),
  }
}
