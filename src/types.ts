/** Non-enumerable key under which the harness attaches call metadata to a result. */
export const TOOL_META: unique symbol = Symbol('mcp-vitest.toolMeta')

export interface ToolCallMeta {
  toolName: string
  outputSchema?: Record<string, unknown>
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>
  structuredContent?: unknown
  isError?: boolean
}

/**
 * Structural subset of an SDK Client that the harness relies on. Both SDK
 * majors' Client satisfy it, so nothing here depends on a specific major.
 */
export interface SdkClientLike {
  listTools(params?: { cursor?: string }): Promise<{
    tools: Array<{
      name: string
      description?: string
      inputSchema?: unknown
      outputSchema?: unknown
    }>
    nextCursor?: string
  }>
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<McpToolResult>
  readResource(params: { uri: string }): Promise<{
    contents: Array<{ uri: string; text?: string; blob?: string }>
  }>
  listResources(params?: { cursor?: string }): Promise<{
    resources: Array<{ uri: string; name?: string }>
    nextCursor?: string
  }>
  getPrompt(params: { name: string; arguments?: Record<string, string> }): Promise<{
    messages: unknown[]
  }>
  listPrompts(params?: { cursor?: string }): Promise<{
    prompts: Array<{ name: string }>
    nextCursor?: string
  }>
  close(): Promise<void>
}

export interface CallToolOptions {
  onProgress?: (p: { progress: number; total?: number; message?: string }) => void
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Protocol revisions a connection can be held to. Only these two are reachable:
 * the client's pin mode accepts modern revisions only, and the 2025 era is
 * selectable just as "legacy", which lands on the SDK's newest 2025 revision.
 */
export type McpLifecycle = '2025-11-25' | '2026-07-28'

export interface RawConnection {
  client: SdkClientLike
  /** Per-major adapter: maps CallToolOptions onto that SDK's request options. */
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    opts?: CallToolOptions,
  ): Promise<McpToolResult>
  onNotification(cb: (n: { method: string; params: unknown }) => void): void
  /** The revision this connection was pinned to, when it was pinned at all. */
  lifecycle?: McpLifecycle
  close(): Promise<void>
}

export type McpServerInput = unknown | (() => unknown | Promise<unknown>)

export interface McpTestOptions {
  /** Auto-close via vitest onTestFinished when inside a test. Default true. */
  autoClose?: boolean
}
