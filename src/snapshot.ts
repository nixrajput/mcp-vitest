import type { McpHarness } from "./harness.js";

// `_meta` is dropped from the entry only; a nested one is the user's own schema
// property and a real change worth catching.
function normalize(value: unknown, dropMeta = false): unknown {
  if (Array.isArray(value)) return value.map((v) => normalize(v, dropMeta));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      if (dropMeta && key === "_meta") continue;
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = normalize(v);
    }
    return out;
  }
  return value;
}

// Generic on purpose: normalizing only sorts keys and drops `_meta`/undefined, so the entry
// shape survives. Returning `unknown` forced a cast on any consumer asserting on a manifest.
function normalizeEntries<T>(entries: T[]): T[] {
  return entries.map((e) => normalize(e, true) as T);
}

// An unadvertised capability answers -32601; for a manifest, "exposes none" is
// honest. Anything else must not be swallowed into a manifest that snapshots green.
function isUnsupportedCapability(error: unknown): boolean {
  if ((error as { code?: unknown })?.code === -32601) return true;
  const message = error instanceof Error ? error.message : String(error);
  // Anchored: a loose match would read "backend does not support X" as absent.
  return (
    /^(MCP error )?-32601\b/.test(message) ||
    /^Server does not support /.test(message) ||
    /^Method not found\b/i.test(message)
  );
}

async function orEmpty<T>(list: Promise<T[]>): Promise<T[]> {
  try {
    return await list;
  } catch (error) {
    if (isUnsupportedCapability(error)) return [];
    throw error;
  }
}

// Code-unit order, not localeCompare: collation varies by host ICU data and locale,
// so a committed snapshot could churn on a different CI image.
function byKey<T>(key: (item: T) => string) {
  return (a: T, b: T) => {
    const x = key(a);
    const y = key(b);
    return x < y ? -1 : x > y ? 1 : 0;
  };
}

export async function toolManifest(mcp: McpHarness) {
  const tools = await orEmpty(mcp.listTools());
  return normalizeEntries([...tools].sort(byKey((t) => t.name)));
}

export async function resourceManifest(mcp: McpHarness) {
  const resources = await orEmpty(mcp.listResources());
  return normalizeEntries([...resources].sort(byKey((r) => r.uri)));
}

export async function promptManifest(mcp: McpHarness) {
  const prompts = await orEmpty(mcp.listPrompts());
  return normalizeEntries([...prompts].sort(byKey((p) => p.name)));
}

export async function capabilitiesManifest(mcp: McpHarness) {
  const [tools, resources, prompts] = await Promise.all([
    orEmpty(mcp.listTools()),
    orEmpty(mcp.listResources()),
    orEmpty(mcp.listPrompts()),
  ]);
  return {
    tools: tools.map((t) => t.name).sort(),
    resources: resources.map((r) => r.uri).sort(),
    prompts: prompts.map((p) => p.name).sort(),
  };
}
