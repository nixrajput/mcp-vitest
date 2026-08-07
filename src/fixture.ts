import { test as baseTest } from 'vitest'
import { type McpHarness, mcpTest } from './harness.js'
import type { McpServerInput, McpTestOptions } from './types.js'

/**
 * `autoClose` is not accepted: the fixture always owns the harness lifetime and
 * closes it after each test, so offering the knob would be a no-op.
 */
export function createMcpTest(
  server: McpServerInput,
  options: Omit<McpTestOptions, 'autoClose'> = {},
) {
  return baseTest.extend<{ mcp: McpHarness }>({
    // biome-ignore lint/correctness/noEmptyPattern: vitest fixture signature
    mcp: async ({}, use) => {
      const harness = await mcpTest(server, { ...options, autoClose: false })
      await use(harness)
      await harness.close()
    },
  })
}
