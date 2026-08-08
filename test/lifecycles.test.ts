import { afterAll, describe, expect, test as vitestTest } from 'vitest'
import { createMcpTest, mcpTest } from '../src/index.js'
import { createV1Server } from './servers/v1.js'
import { createV2Server } from './servers/v2.js'

const test = createMcpTest(() => createV2Server(), {
  lifecycles: ['2025-11-25', '2026-07-28'],
})

const seen: string[] = []

describe('lifecycle matrix', () => {
  test('echo works on every lifecycle', async ({ mcp, task }) => {
    seen.push(mcp.lifecycle ?? 'unknown')
    // The suffix is the only way a reporter distinguishes the variants, so assert
    // it directly rather than inferring it from the count of harnesses that ran.
    expect(task.name).toBe(`echo works on every lifecycle [${mcp.lifecycle}]`)
    const result = await mcp.callTool('echo', { message: 'x' })
    expect(result).toHaveTextContent('echo: x')
  })

  afterAll(() => {
    expect(seen.sort()).toEqual(['2025-11-25', '2026-07-28'])
  })
})

describe('lifecycle guards', () => {
  vitestTest('a v1 server refuses the 2026 lifecycle', async () => {
    await expect(mcpTest(createV1Server(), { protocolVersion: '2026-07-28' })).rejects.toThrow(
      /v1 SDK cannot serve the 2026-07-28 lifecycle/,
    )
  })

  // Registering a double here would otherwise hang until the request timeout.
  vitestTest('doubles are refused on a 2025-era v2 connection', async () => {
    const mcp = await mcpTest(() => createV2Server(), { protocolVersion: '2025-11-25' })
    expect(() => mcp.onElicitation({ action: 'accept' })).toThrow(
      /onElicitation\(\) needs a connection that can carry server-initiated/,
    )
    expect(() =>
      mcp.onSampling(() => ({
        model: 'm',
        role: 'assistant',
        content: { type: 'text', text: 'x' },
      })),
    ).toThrow(/onSampling\(\) needs a connection that can carry server-initiated/)
  })

  vitestTest('an unpinned v1 harness reports no lifecycle', async () => {
    const mcp = await mcpTest(createV1Server())
    expect(mcp.lifecycle).toBeUndefined()
  })

  vitestTest('an empty lifecycles array is refused', () => {
    expect(() => createMcpTest(() => createV2Server(), { lifecycles: [] })).toThrow(
      /empty `lifecycles` array/,
    )
  })

  vitestTest('createMcpTest honours a bare protocolVersion', async () => {
    const mcp = await mcpTest(() => createV2Server(), { protocolVersion: '2025-11-25' })
    expect(mcp.lifecycle).toBe('2025-11-25')
  })
})
