import { afterAll, bench, describe, expect } from 'vitest'
import { mcpTest } from '../src/index.js'
import { registerMatchers } from '../src/matchers.js'
import { toolManifest } from '../src/snapshot.js'
import { createV1Server } from '../test/servers/v1.js'
import { createV2Server } from '../test/servers/v2.js'

// vitest.config.ts setupFiles applies to tests, not bench runs.
registerMatchers()

// Kept short in hook mode: these numbers are indicative, not publication grade.
const time = Number(process.env.MCP_VITEST_BENCH_TIME_MS ?? 500)
const opts = { time, warmupTime: Math.min(100, time) }

const majors = [
  ['v1', () => mcpTest(createV1Server(), { autoClose: false })],
  ['v2', () => mcpTest(() => createV2Server(), { autoClose: false })],
] as const

describe.each(majors)('connect (%s)', (_label, make) => {
  bench(
    'connect + initialize',
    async () => {
      const mcp = await make()
      await mcp.close()
    },
    opts,
  )
})

describe.each(majors)('operations (%s)', (_label, make) => {
  // One harness per suite: measuring the operation, not the connect cost.
  let mcp: Awaited<ReturnType<typeof make>>

  bench(
    'listTools',
    async () => {
      await mcp.listTools()
    },
    {
      ...opts,
      setup: async () => {
        mcp ??= await make()
      },
    },
  )

  bench(
    'callTool echo',
    async () => {
      await mcp.callTool('echo', { message: 'bench' })
    },
    {
      ...opts,
      setup: async () => {
        mcp ??= await make()
      },
    },
  )

  bench(
    'toolManifest',
    async () => {
      await toolManifest(mcp)
    },
    {
      ...opts,
      setup: async () => {
        mcp ??= await make()
      },
    },
  )

  bench(
    'matcher toHaveTool',
    async () => {
      await expect(mcp).toHaveTool('echo')
    },
    {
      ...opts,
      setup: async () => {
        mcp ??= await make()
      },
    },
  )

  // autoClose is false here, and a live v2 handler can keep the process alive.
  afterAll(async () => {
    await mcp?.close()
  })
})
