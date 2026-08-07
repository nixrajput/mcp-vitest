import { describe, expect, test } from 'vitest'
import { connectV1 } from '../src/connect/v1.js'
import { createV1Server } from './servers/v1.js'

describe('connectV1', () => {
  test('round-trips listTools and callTool in memory', async () => {
    const { client, close } = await connectV1(createV1Server())
    try {
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name).sort()).toEqual([
        'ask',
        'boom',
        'echo',
        'list-roots',
        'slow',
        'summarize',
        'weather',
        'weather-bad',
        'weather-strict',
      ])

      const result = await client.callTool({
        name: 'echo',
        arguments: { message: 'hi' },
      })
      expect(result.content[0]).toMatchObject({ type: 'text', text: 'echo: hi' })
    } finally {
      await close()
    }
  })

  test('close() is idempotent', async () => {
    const conn = await connectV1(createV1Server())
    await conn.close()
    await expect(conn.close()).resolves.toBeUndefined()
  })
})
