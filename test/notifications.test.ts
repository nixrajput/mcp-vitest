import { describe, expect, test } from 'vitest'
import { mcpTest } from '../src/index.js'
import { createV1Server } from './servers/v1.js'
import { createV2Server } from './servers/v2.js'

describe('notification collector (v1)', () => {
  test('collects progress notifications from a tool call', async () => {
    const mcp = await mcpTest(createV1Server())
    const all = mcp.notifications()
    await mcp.callTool('slow', { ms: 200 }, { onProgress: () => {} })
    const progress = all.items.filter((n) => n.method === 'notifications/progress')
    expect(progress.length).toBeGreaterThanOrEqual(1)
  })

  test('waitFor resolves on a matching notification', async () => {
    const mcp = await mcpTest(createV1Server())
    const collector = mcp.notifications('notifications/progress')
    const pending = collector.waitFor((n) => (n.params as { progress: number }).progress >= 5)
    await mcp.callTool('slow', { ms: 300 }, { onProgress: () => {} })
    await expect(pending).resolves.toMatchObject({ method: 'notifications/progress' })
  })

  test('waitFor times out with a clear error', async () => {
    const mcp = await mcpTest(createV1Server())
    const collector = mcp.notifications('notifications/tools/list_changed')
    await expect(collector.waitFor(() => true, 100)).rejects.toThrow(/timed out/i)
  })

  // Guards against double counting: progress is fanned out from the callTool
  // adapter, so a second delivery path would show up as duplicated items.
  test('each progress notification is collected exactly once', async () => {
    const mcp = await mcpTest(createV1Server())
    const collector = mcp.notifications('notifications/progress')
    await mcp.callTool('slow', { ms: 100 })
    expect(collector.items).toHaveLength(10)
    expect(collector.items.map((n) => (n.params as { progress: number }).progress)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ])
  })
})

describe('notification collector (v2)', () => {
  test('collects progress, the only stream open under the 2026 lifecycle', async () => {
    const mcp = await mcpTest(() => createV2Server())
    const collector = mcp.notifications('notifications/progress')
    await mcp.callTool('slow', { ms: 100 })
    expect(collector.items).toHaveLength(10)
  })
})
