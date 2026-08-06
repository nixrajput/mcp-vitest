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
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>
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

export interface RawConnection {
  client: SdkClientLike
  close(): Promise<void>
}

export type McpServerInput = unknown | (() => unknown | Promise<unknown>)

export interface McpTestOptions {
  /** Auto-close via vitest onTestFinished when inside a test. Default true. */
  autoClose?: boolean
}
