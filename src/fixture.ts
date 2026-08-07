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
 * The matrix form registers plain tests only. Typing it as call signatures rather
 * than as the full vitest test object is deliberate: `.skip`, `.only`, `.each`,
 * and `.extend` do not exist on it, so reaching for one is a compile error
 * instead of a `TypeError` at collection time.
 *
 * The pair mirrors vitest's own overloads exactly. Collapsing them into one
 * signature with `number | TestOptions` in third position would type-approve
 * `test(name, fn, { timeout })`, which vitest 4 removed and throws on.
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
/**
 * `autoClose` is not accepted: the fixture always owns the harness lifetime and
 * closes it after each test, so offering the knob would be a no-op.
 *
 * With `lifecycles`, each declared test is registered once per revision with the
 * revision appended to its name.
 */
export function createMcpTest(
  server: McpServerInput,
  options: McpTestOptionsNoAutoClose & { lifecycles?: McpLifecycle[] } = {},
): BaseMcpTest | LifecycleMcpTest {
  const { lifecycles, ...rest } = options
  if (!lifecycles) return makeTest(server, rest)
  // An empty matrix would register every test once, unpinned, and read as though
  // revisions had been covered. A computed-empty list is a caller bug, not a mode.
  if (lifecycles.length === 0) {
    throw new Error(
      'mcp-vitest: createMcpTest was given an empty `lifecycles` array. Pass at least ' +
        'one revision, or omit the option entirely for a single auto-negotiated harness.',
    )
  }

  const variants = lifecycles.map((lc) => ({ lc, t: makeTest(server, rest, lc) }))
  // Everything after the name is forwarded to vitest untouched, so the callback
  // and any options/timeout keep working without restating vitest's overloads.
  const multi = (name: string, ...rest2: unknown[]) => {
    for (const { lc, t } of variants) {
      ;(t as unknown as (n: string, ...a: unknown[]) => void)(`${name} [${lc}]`, ...rest2)
    }
  }
  return multi as LifecycleMcpTest
}
