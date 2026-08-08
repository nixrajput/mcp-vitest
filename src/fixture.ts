import type { TestContext, TestOptions } from 'vitest'
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

type McpTestOptionsNoAutoClose = Omit<McpTestOptions, 'autoClose'>

type LifecycleTestFn = (ctx: TestContext & { mcp: McpHarness }) => unknown

/**
 * Plain tests only: `.skip`/`.only`/`.each`/`.extend` are absent so misuse is a
 * compile error. The pair mirrors vitest's own; merging them would admit
 * `test(name, fn, { timeout })`, which vitest 4 removed.
 */
export interface LifecycleMcpTest {
  (name: string, fn: LifecycleTestFn, timeout?: number): void
  (name: string, options: TestOptions, fn: LifecycleTestFn): void
}

export function createMcpTest(
  server: McpServerInput,
  options?: McpTestOptionsNoAutoClose & { lifecycles?: undefined },
): BaseMcpTest
export function createMcpTest(
  server: McpServerInput,
  options: McpTestOptionsNoAutoClose & { lifecycles: McpLifecycle[] },
): LifecycleMcpTest
/** `autoClose` is absent because the fixture always owns the harness lifetime. */
export function createMcpTest(
  server: McpServerInput,
  options: McpTestOptionsNoAutoClose & { lifecycles?: McpLifecycle[] } = {},
): BaseMcpTest | LifecycleMcpTest {
  const { lifecycles, ...rest } = options
  if (!lifecycles) return makeTest(server, rest)
  // An empty matrix would register unpinned tests that read as covering revisions.
  if (lifecycles.length === 0) {
    throw new Error(
      'mcp-vitest: createMcpTest was given an empty `lifecycles` array. Pass at least ' +
        'one revision, or omit the option entirely for a single auto-negotiated harness.',
    )
  }

  const variants = lifecycles.map((lc) => ({ lc, t: makeTest(server, rest, lc) }))
  // Args after the name pass through untouched rather than restating vitest's overloads.
  const multi = (name: string, ...rest2: unknown[]) => {
    for (const { lc, t } of variants) {
      ;(t as unknown as (n: string, ...a: unknown[]) => void)(`${name} [${lc}]`, ...rest2)
    }
  }
  return multi as LifecycleMcpTest
}
