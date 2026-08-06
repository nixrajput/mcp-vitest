export type ServerKind = 'v1' | 'v2'

async function tryImport(specifier: string): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import(specifier)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

type Ctor = abstract new (...args: never[]) => unknown

export async function detectServerKind(server: unknown): Promise<ServerKind> {
  const v2 = await tryImport('@modelcontextprotocol/server')
  for (const name of ['McpServer', 'Server']) {
    const ctor = v2?.[name] as Ctor | undefined
    if (ctor && server instanceof ctor) return 'v2'
  }
  const v1High = await tryImport('@modelcontextprotocol/sdk/server/mcp.js')
  const v1Low = await tryImport('@modelcontextprotocol/sdk/server/index.js')
  for (const [mod, name] of [
    [v1High, 'McpServer'],
    [v1Low, 'Server'],
  ] as const) {
    const ctor = mod?.[name] as Ctor | undefined
    if (ctor && server instanceof ctor) return 'v1'
  }
  throw new TypeError(
    'mcp-vitest: unrecognized server. Pass an McpServer instance (or factory) from ' +
      '@modelcontextprotocol/sdk (v1) or @modelcontextprotocol/server (v2), and make ' +
      'sure that SDK package is installed.',
  )
}
