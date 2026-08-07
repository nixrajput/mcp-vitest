import { describe, expect, test } from 'vitest'
import { mcpTest } from '../src/index.js'
import { createV1Server } from './servers/v1.js'
import { createV2Server } from './servers/v2.js'

describe.each([
  ['v1', () => mcpTest(createV1Server())],
  ['v2', () => mcpTest(() => createV2Server())],
])('call options (%s)', (_label, make) => {
  test('onProgress receives updates', async () => {
    const mcp = await make()
    const seen: number[] = []
    await mcp.callTool('slow', { ms: 200 }, { onProgress: (p) => seen.push(p.progress) })
    expect(seen.length).toBeGreaterThanOrEqual(1)
    expect(seen.at(-1)).toBe(10)
  })

  test('signal cancels a slow call', async () => {
    const mcp = await make()
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 50)
    await expect(mcp.callTool('slow', { ms: 5000 }, { signal: ac.signal })).rejects.toThrow()
  })

  test('timeoutMs rejects a slow call', async () => {
    const mcp = await make()
    await expect(mcp.callTool('slow', { ms: 5000 }, { timeoutMs: 100 })).rejects.toThrow()
  })
})
