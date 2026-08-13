/** Non-enumerable key under which the harness attaches call metadata to a result. */
export const TOOL_META: unique symbol = Symbol("mcp-vitest.toolMeta");

/** Wire identity, single-sourced; test/connect-v1.test.ts pins it to package.json. */
export const CLIENT_INFO = { name: "mcp-vitest", version: "0.5.1" } as const;

export interface ToolCallMeta {
  toolName: string;
  outputSchema?: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

/**
 * Structural subset of an SDK Client that the harness relies on. Both SDK
 * majors' Client satisfy it, so nothing here depends on a specific major.
 */
export interface SdkClientLike {
  listTools(params?: { cursor?: string }): Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: unknown;
      outputSchema?: unknown;
    }>;
    nextCursor?: string;
  }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<McpToolResult>;
  readResource(params: { uri: string }): Promise<{
    contents: Array<{ uri: string; text?: string; blob?: string }>;
  }>;
  listResources(params?: { cursor?: string }): Promise<{
    resources: Array<{ uri: string; name?: string }>;
    nextCursor?: string;
  }>;
  getPrompt(params: { name: string; arguments?: Record<string, string> }): Promise<{
    messages: unknown[];
  }>;
  listPrompts(params?: { cursor?: string }): Promise<{
    prompts: Array<{ name: string }>;
    nextCursor?: string;
  }>;
  complete(params: { ref: CompletionRef; argument: CompletionArgument }): Promise<CompletionResult>;
  close(): Promise<void>;
}

export type CompletionRef =
  | { type: "ref/prompt"; name: string }
  | { type: "ref/resource"; uri: string };

export interface CompletionArgument {
  name: string;
  value: string;
}

export interface CompletionResult {
  completion: { values: string[]; total?: number; hasMore?: boolean };
}

export interface CallToolOptions {
  onProgress?: (p: { progress: number; total?: number; message?: string }) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Only two are reachable: pinning accepts modern revisions, 2025 only as "legacy". */
export type McpLifecycle = "2025-11-25" | "2026-07-28";

export interface RawConnection {
  client: SdkClientLike;
  /** Per-major adapter: maps CallToolOptions onto that SDK's request options. */
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    opts?: CallToolOptions,
  ): Promise<McpToolResult>;
  onNotification(cb: (n: { method: string; params: unknown }) => void): void;
  /** The revision this connection was pinned to, when it was pinned at all. */
  lifecycle?: McpLifecycle;
  /**
   * What this lane can serve. Required so a new lane cannot omit it and silently
   * read as "supports everything".
   */
  supports: { roots: boolean; serverInitiatedRequests: boolean };
  close(): Promise<void>;
}

/** Spawns a server as a child process and speaks MCP over its stdio pipes. */
export interface StdioServerSpec {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export function isStdioServerSpec(input: unknown): input is StdioServerSpec {
  return (
    typeof input === "object" &&
    input !== null &&
    typeof (input as StdioServerSpec).command === "string"
  );
}

/** Connects to an already-running server over Streamable HTTP. */
export interface UrlServerSpec {
  url: string | URL;
  /** Merged into every request, e.g. an Authorization header. */
  headers?: Record<string, string>;
}

export function isUrlServerSpec(input: unknown): input is UrlServerSpec {
  if (typeof input !== "object" || input === null) return false;
  const url = (input as UrlServerSpec).url;
  return typeof url === "string" || url instanceof URL;
}

/** Any object: both SDK majors' server instances satisfy this, primitives do not. */
type ServerLike = Record<string, unknown> | object;

export type McpServerInput =
  | StdioServerSpec
  | UrlServerSpec
  | ServerLike
  | (() => ServerLike | Promise<ServerLike>);

export interface McpTestOptions {
  /** Auto-close via vitest onTestFinished when inside a test. Default true. */
  autoClose?: boolean;
  /** v1 can only be held to '2025-11-25', the single revision its SDK negotiates. */
  protocolVersion?: McpLifecycle;
  /** Sent on every request by the URL transport. `token` becomes a Bearer header. */
  auth?: { token: string } | { headers: Record<string, string> };
}
