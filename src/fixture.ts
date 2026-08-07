import { test as baseTest } from 'vitest'
import { type McpHarness, mcpTest } from './harness.js'
import type { McpLifecycle, McpServerInput, McpTestOptions } from './types.js'

type BaseMcpTest = ReturnType<typeof makeTest>

function makeTest(
  server: McpServerInput,
  options: Omit<McpTestOptions, 'autoClose'>,
  lifecycle?: McpLifecycle,
) {
  return baseTest.extend<{ mcp: McpHarness }>({
    // biome-ignore lint/correctness/noEmptyPattern: vitest fixture signature
    mcp: async ({}, use) => {
      const harness = await mcpTest(server, {
        ...options,
        protocolVersion: lifecycle ?? options.protocolVersion,
        autoClose: false,
      })
      await use(harness)
      await harness.close()
    },
  })
}

/**
 * `autoClose` is not accepted: the fixture always owns the harness lifetime and
 * closes it after each test, so offering the knob would be a no-op.
 *
 * With `lifecycles`, each declared test is registered once per revision with the
 * revision appended to its name. Only plain `test(name, fn)` is forwarded in that
 * mode - `.skip`/`.only`/`.each` are not.
 */
export function createMcpTest(
  server: McpServerInput,
  options: Omit<McpTestOptions, 'autoClose'> & { lifecycles?: McpLifecycle[] } = {},
): BaseMcpTest {
  const { lifecycles, ...rest } = options
  if (!lifecycles || lifecycles.length === 0) return makeTest(server, rest)

  const variants = lifecycles.map((lc) => ({ lc, t: makeTest(server, rest, lc) }))
  // Everything after the name is forwarded to vitest untouched, so the callback
  // and any options/timeout keep working without restating vitest's overloads.
  const multi = (name: string, ...rest2: unknown[]) => {
    for (const { lc, t } of variants) {
      ;(t as unknown as (n: string, ...a: unknown[]) => void)(`${name} [${lc}]`, ...rest2)
    }
  }
  return multi as unknown as BaseMcpTest
}
