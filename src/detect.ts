/**
 * `external` covers servers mcp-vitest did not construct - a spawned stdio
 * process or a remote URL. `detectServerKind` never returns it: those inputs are
 * recognized by shape and routed before any SDK detection happens.
 */
export type ServerKind = 'v1' | 'v2' | 'external'

const MISSING_MODULE = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'])

async function tryImport(
  specifier: string,
  problems: string[],
): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import(specifier)) as Record<string, unknown>
  } catch (error) {
    // A package that is simply absent is expected - the SDKs are optional peers.
    // Anything else (a broken transitive dep, a bad install) is real and must
    // not be reported as "unrecognized server".
    const code = (error as { code?: string }).code
    if (!code || !MISSING_MODULE.has(code)) {
      problems.push(`${specifier}: ${error instanceof Error ? error.message : String(error)}`)
    }
    return undefined
  }
}

type Ctor = abstract new (...args: never[]) => unknown

function isInstanceOfAny(
  server: unknown,
  mod: Record<string, unknown> | undefined,
  names: string[],
) {
  for (const name of names) {
    const ctor = mod?.[name] as Ctor | undefined
    if (ctor && server instanceof ctor) return true
  }
  return false
}

// instanceof fails when the consumer built their server from a different
// physical copy of the SDK than we resolve (version conflicts, nested deps,
// pnpm and monorepo layouts). Walking the prototype chain for the constructor
// name survives that, so it is the fallback rather than the primary check.
function hasConstructorNamed(server: unknown, names: string[]): boolean {
  for (let proto = server; proto; proto = Object.getPrototypeOf(proto)) {
    const name = (proto as { constructor?: { name?: string } }).constructor?.name
    if (name && names.includes(name)) return true
  }
  return false
}

export async function detectServerKind(server: unknown): Promise<ServerKind> {
  if (!server || (typeof server !== 'object' && typeof server !== 'function')) {
    throw new TypeError(
      `mcp-vitest: unrecognized server (received ${server === null ? 'null' : typeof server}). ` +
        'Pass an McpServer instance, or a factory returning one.',
    )
  }

  const problems: string[] = []
  const v2 = await tryImport('@modelcontextprotocol/server', problems)
  if (isInstanceOfAny(server, v2, ['McpServer', 'Server'])) return 'v2'

  const v1High = await tryImport('@modelcontextprotocol/sdk/server/mcp.js', problems)
  const v1Low = await tryImport('@modelcontextprotocol/sdk/server/index.js', problems)
  if (
    isInstanceOfAny(server, v1High, ['McpServer']) ||
    isInstanceOfAny(server, v1Low, ['Server'])
  ) {
    return 'v1'
  }

  // Duplicate-copy fallback: name the era by which package resolved, preferring
  // v2 only when it is the one actually installed.
  if (hasConstructorNamed(server, ['McpServer', 'Server'])) {
    if (v2 && !v1High && !v1Low) return 'v2'
    if ((v1High || v1Low) && !v2) return 'v1'
  }

  throw new TypeError(
    'mcp-vitest: unrecognized server. Pass an McpServer instance (or factory) from ' +
      '@modelcontextprotocol/sdk (v1) or @modelcontextprotocol/server (v2), and make ' +
      'sure that SDK package is installed. For a server you cannot import, pass ' +
      '{ command, args } to spawn one over stdio or { url } to reach a running one.' +
      (problems.length ? ` SDK imports failed: ${problems.join('; ')}` : '') +
      (hasConstructorNamed(server, ['McpServer', 'Server'])
        ? ' The object looks like an McpServer but is not an instance of the copy ' +
          'mcp-vitest resolved, and both SDK majors are installed, so its major is ' +
          'ambiguous - deduplicate the SDK in node_modules.'
        : ''),
  )
}
