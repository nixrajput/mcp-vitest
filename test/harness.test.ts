import { describe, expect, test } from 'vitest'
import { detectServerKind, mcpTest } from '../src/index.js'
import { createV1Server } from './servers/v1.js'
import { createV2Server } from './servers/v2.js'

describe('detectServerKind', () => {
  test('recognizes a v1 server', async () => {
    await expect(detectServerKind(createV1Server())).resolves.toBe('v1')
  })
  test('recognizes a v2 server', async () => {
    await expect(detectServerKind(createV2Server())).resolves.toBe('v2')
  })
  test('rejects garbage with a helpful message', async () => {
    await expect(detectServerKind({})).rejects.toThrow(/unrecognized server/i)
  })
})

describe('mcpTest', () => {
  test('accepts a v1 instance', async () => {
    const mcp = await mcpTest(createV1Server(), { autoClose: false })
    expect(mcp.kind).toBe('v1')
    const tools = await mcp.listTools()
    expect(tools.map((t) => t.name)).toContain('echo')
    await mcp.close()
  })

  test('accepts a v2 factory', async () => {
    const mcp = await mcpTest(() => createV2Server(), { autoClose: false })
    expect(mcp.kind).toBe('v2')
    const result = await mcp.callTool('echo', { message: 'yo' })
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'echo: yo' })
    await mcp.close()
  })

  test('accepts a v2 instance', async () => {
    const mcp = await mcpTest(createV2Server(), { autoClose: false })
    expect(mcp.kind).toBe('v2')
    const result = await mcp.callTool('echo', { message: 'reused' })
    expect(result.content[0]).toMatchObject({ text: 'echo: reused' })
    await mcp.close()
  })

  test('accepts a v1 factory', async () => {
    const mcp = await mcpTest(() => createV1Server(), { autoClose: false })
    expect(mcp.kind).toBe('v1')
    await mcp.close()
  })
})
