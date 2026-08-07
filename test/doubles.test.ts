import { describe, expect, test } from 'vitest'
import { mcpTest } from '../src/index.js'
import { createV1Server } from './servers/v1.js'
import { createV2Server } from './servers/v2.js'

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

// Same observable contract, a completely different mechanism underneath: the
// server answers with input_required and the client's driver retries the call.
describe('doubles (v2 / 2026 lifecycle)', () => {
  test('sampling double answers a summarize call', async () => {
    const mcp = await mcpTest(() => createV2Server())
    mcp.onSampling((req) => {
      expect(req.maxTokens).toBe(50)
      return { model: 'double', role: 'assistant', content: { type: 'text', text: 'short' } }
    })
    const result = await mcp.callTool('summarize', { text: 'a very long text' })
    expect(result).toHaveTextContent('summary: short')
  })

  test('elicitation double with constant result', async () => {
    const mcp = await mcpTest(() => createV2Server())
    mcp.onElicitation({ action: 'accept', content: { confirm: true } })
    const result = await mcp.callTool('ask', { question: 'Proceed?' })
    expect(result).toHaveTextContent('answer: {"confirm":true}')
  })

  test('a declined elicitation reaches the tool', async () => {
    const mcp = await mcpTest(() => createV2Server())
    mcp.onElicitation({ action: 'decline' })
    const result = await mcp.callTool('ask', { question: 'Proceed?' })
    expect(result).toHaveTextContent('declined')
  })

  // Deliberately different from v1's expectation. On v1 the missing-double error
  // travels to the server as a JSON-RPC error and comes back as a tool error. On
  // v2 the client's own MRTR driver invokes the double, so it rejects the caller
  // directly - the better outcome, and the reason this is asserted per major.
  test('unregistered double rejects the call', async () => {
    const mcp = await mcpTest(() => createV2Server())
    await expect(mcp.callTool('summarize', { text: 'x' })).rejects.toThrow(
      /no double is registered/i,
    )
  })

  test('the connection negotiates the 2026 lifecycle', async () => {
    const mcp = await mcpTest(() => createV2Server())
    expect(mcp.lifecycle).toBe('2026-07-28')
  })
})
