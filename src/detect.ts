/** `external` is routed by shape before detection, so detectServerKind never returns it. */
export type ServerKind = "v1" | "v2" | "external";

const MISSING_MODULE = new Set(["ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED"]);

async function tryImport(
  specifier: string,
  problems: string[],
): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import(specifier)) as Record<string, unknown>;
  } catch (error) {
    // The SDKs are optional peers, so absence is expected; anything else is real
    // and must not be reported as "unrecognized server".
    const code = (error as { code?: string }).code;
    if (!code || !MISSING_MODULE.has(code)) {
      problems.push(`${specifier}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return undefined;
  }
}

type Ctor = abstract new (...args: never[]) => unknown;

function isInstanceOfAny(
  server: unknown,
  mod: Record<string, unknown> | undefined,
  names: string[],
) {
  for (const name of names) {
    const ctor = mod?.[name] as Ctor | undefined;
    if (ctor && server instanceof ctor) return true;
  }
  return false;
}

// instanceof fails across duplicate SDK copies (nested deps, pnpm, monorepos),
// which the prototype-chain name survives - hence a fallback, not the primary check.
function hasConstructorNamed(server: unknown, names: string[]): boolean {
  for (let proto = server; proto; proto = Object.getPrototypeOf(proto)) {
    const name = (proto as { constructor?: { name?: string } }).constructor?.name;
    if (name && names.includes(name)) return true;
  }
  return false;
}

export async function detectServerKind(server: unknown): Promise<ServerKind> {
  if (!server || (typeof server !== "object" && typeof server !== "function")) {
    throw new TypeError(
      `mcp-vitest: unrecognized server (received ${server === null ? "null" : typeof server}). ` +
        "Pass an McpServer instance, or a factory returning one.",
    );
  }

  const problems: string[] = [];
  const v2 = await tryImport("@modelcontextprotocol/server", problems);
  if (isInstanceOfAny(server, v2, ["McpServer", "Server"])) return "v2";

  const v1High = await tryImport("@modelcontextprotocol/sdk/server/mcp.js", problems);
  const v1Low = await tryImport("@modelcontextprotocol/sdk/server/index.js", problems);
  if (
    isInstanceOfAny(server, v1High, ["McpServer"]) ||
    isInstanceOfAny(server, v1Low, ["Server"])
  ) {
    return "v1";
  }

  // Duplicate-copy fallback: name the era by whichever package actually resolved.
  if (hasConstructorNamed(server, ["McpServer", "Server"])) {
    if (v2 && !v1High && !v1Low) return "v2";
    if ((v1High || v1Low) && !v2) return "v1";
  }

  throw new TypeError(
    "mcp-vitest: unrecognized server. Pass an McpServer instance (or factory) from " +
      "@modelcontextprotocol/sdk (v1) or @modelcontextprotocol/server (v2), and make " +
      "sure that SDK package is installed. For a server you cannot import, pass " +
      "{ command, args } to spawn one over stdio or { url } to reach a running one." +
      (problems.length ? ` SDK imports failed: ${problems.join("; ")}` : "") +
      (hasConstructorNamed(server, ["McpServer", "Server"])
        ? " The object looks like an McpServer but is not an instance of the copy " +
          "mcp-vitest resolved, and both SDK majors are installed, so its major is " +
          "ambiguous - deduplicate the SDK in node_modules."
        : ""),
  );
}
