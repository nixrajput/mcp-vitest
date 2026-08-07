import { describe, expect, test } from 'vitest'
import { connectV2 } from '../src/connect/v2.js'
import { createV2Server } from './servers/v2.js'

describe('connectV2', () => {
  test('round-trips listTools and callTool via handler.fetch', async () => {
    const { client, close } = await connectV2(() => createV2Server())
    try {
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name).sort()).toEqual([
        'boom',
        'echo',
        'slow',
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

  test('supports async factories', async () => {
    const { client, close } = await connectV2(async () => createV2Server())
    try {
      const { tools } = await client.listTools()
      expect(tools.length).toBeGreaterThan(0)
    } finally {
      await close()
    }
  })
})
