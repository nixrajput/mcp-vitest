import { describe, expect, test } from 'vitest'
import { mcpTest } from '../src/index.js'
import { createV1Server } from './servers/v1.js'

describe('doubles (v1 legacy mechanism)', () => {
  test('sampling double answers a summarize call', async () => {
    const mcp = await mcpTest(createV1Server())
    mcp.onSampling((req) => {
      expect(req.maxTokens).toBe(50)
      return { model: 'double', role: 'assistant', content: { type: 'text', text: 'short' } }
    })
    const result = await mcp.callTool('summarize', { text: 'a very long text' })
    expect(result).toHaveTextContent('summary: short')
  })

  test('elicitation double with constant result', async () => {
    const mcp = await mcpTest(createV1Server())
    mcp.onElicitation({ action: 'accept', content: { confirm: true } })
    const result = await mcp.callTool('ask', { question: 'Proceed?' })
    expect(result).toHaveTextContent('answer: {"confirm":true}')
  })

  test('roots double serves list-roots', async () => {
    const mcp = await mcpTest(createV1Server())
    mcp.onRoots([{ uri: 'file:///workspace' }])
    const result = await mcp.callTool('list-roots')
    expect(result).toHaveTextContent('roots: file:///workspace')
  })

  test('unregistered double throws a helpful error', async () => {
    const mcp = await mcpTest(createV1Server())
    const result = await mcp.callTool('summarize', { text: 'x' })
    // the server surfaces the client-side error as a tool error
    expect(result).toBeToolError(/no double is registered/i)
  })
})
