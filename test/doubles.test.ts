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

  test('a declined elicitation reaches the tool', async () => {
    const mcp = await mcpTest(createV1Server())
    mcp.onElicitation({ action: 'decline' })
    const result = await mcp.callTool('ask', { question: 'Proceed?' })
    expect(result).toHaveTextContent('declined')
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

  test('roots doubles are refused on v2', async () => {
    const mcp = await mcpTest(() => createV2Server())
    expect(() => mcp.onRoots([{ uri: 'file:///workspace' }])).toThrow(/roots doubles are v1-only/)
  })

  // `lifecycle` reports what the connection is held to, so on its own it would
  // still read '2026-07-28' if the pin were deleted. The double firing is the
  // behavioral proof: MRTR only exists on the 2026 era, so a dropped pin fails here.
  test('the connection really runs the 2026 MRTR flow', async () => {
    const mcp = await mcpTest(() => createV2Server())
    let calls = 0
    mcp.onElicitation(() => {
      calls++
      return { action: 'accept', content: { confirm: true } }
    })
    const result = await mcp.callTool('ask', { question: 'Proceed?' })
    expect(calls).toBe(1)
    expect(result).toHaveTextContent('answer: {"confirm":true}')
    expect(mcp.lifecycle).toBe('2026-07-28')
  })

  // Documents a real interaction between two shipped features: the SDK's
  // input-required driver reports each fulfilment round through onprogress, and
  // the bus fans that out. These events originate in the client, not the server.
  test('MRTR rounds surface as synthetic progress events', async () => {
    const mcp = await mcpTest(() => createV2Server())
    mcp.onElicitation({ action: 'accept', content: { confirm: true } })
    const progress = mcp.notifications('notifications/progress')
    const seen: Array<{ progress: number; message?: string }> = []
    await mcp.callTool('ask', { question: 'Proceed?' }, { onProgress: (p) => seen.push(p) })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]?.message).toMatch(/input required/i)
    expect(progress.items.length).toBe(seen.length)
  })
})
