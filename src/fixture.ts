import { test as baseTest } from 'vitest'
import { type McpHarness, mcpTest } from './harness.js'
import type { McpServerInput, McpTestOptions } from './types.js'

export function createMcpTest(server: McpServerInput, options: McpTestOptions = {}) {
  return baseTest.extend<{ mcp: McpHarness }>({
    // biome-ignore lint/correctness/noEmptyPattern: vitest fixture signature
    mcp: async ({}, use) => {
      const harness = await mcpTest(server, { ...options, autoClose: false })
      await use(harness)
      await harness.close()
    },
  })
}
