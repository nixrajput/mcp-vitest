import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, test } from 'vitest'
import { mcpTest } from '../src/index.js'
import { capabilitiesManifest, promptManifest, toolManifest } from '../src/snapshot.js'
import { createV1Server } from './servers/v1.js'

function toolsOnlyServer() {
  const server = new McpServer({ name: 'tools-only', version: '1.0.0' })
  server.registerTool('only', { description: 'The sole tool' }, async () => ({
    content: [{ type: 'text', text: 'ok' }],
  }))
  return server
}

describe('manifests on servers without every capability', () => {
  test('capabilitiesManifest reports absent capabilities as empty', async () => {
    const mcp = await mcpTest(toolsOnlyServer())
    const caps = (await capabilitiesManifest(mcp)) as Record<string, string[]>
    expect(caps).toEqual({ tools: ['only'], resources: [], prompts: [] })
  })

  test('promptManifest is empty rather than throwing', async () => {
    const mcp = await mcpTest(toolsOnlyServer())
    await expect(promptManifest(mcp)).resolves.toEqual([])
  })

  // Tolerating an absent capability must not tolerate a broken connection:
  // an empty manifest that snapshots green would hide the failure.
  test('a real failure still propagates instead of snapshotting empty', async () => {
    const mcp = await mcpTest(createV1Server())
    const client = mcp.client as unknown as { listPrompts: () => Promise<never> }
    client.listPrompts = () => Promise.reject(new Error('socket hang up'))
    await expect(promptManifest(mcp)).rejects.toThrow(/socket hang up/)
  })
})

describe('request transparency', () => {
  test('a bare callTool sends no progressToken', async () => {
    const server = new McpServer({ name: 'spy', version: '1.0.0' })
    let meta: unknown
    server.registerTool('spy', { description: 'Records its _meta' }, async (extra) => {
      meta = (extra as { _meta?: unknown })._meta
      return { content: [{ type: 'text', text: 'ok' }] }
    })
    const mcp = await mcpTest(server)
    await mcp.callTool('spy')
    expect((meta as { progressToken?: unknown } | undefined)?.progressToken).toBeUndefined()
  })

  test('a progress token is sent when a collector is listening', async () => {
    const mcp = await mcpTest(createV1Server())
    const collector = mcp.notifications('notifications/progress')
    await mcp.callTool('slow', { ms: 50 })
    expect(collector.items).toHaveLength(10)
  })
})

describe('callTool does not depend on tools/list', () => {
  test('a failing tools/list still yields the tool result', async () => {
    const mcp = await mcpTest(createV1Server())
    const client = mcp.client as unknown as { listTools: () => Promise<never> }
    const original = client.listTools
    client.listTools = () => Promise.reject(new Error('tools/list blew up'))
    try {
      const result = await mcp.callTool('echo', { message: 'still works' })
      expect(result).toHaveTextContent('echo: still works')
    } finally {
      client.listTools = original
    }
  })
})

describe('toHaveContent', () => {
  test('rejects an empty partial instead of passing vacuously', async () => {
    const mcp = await mcpTest(createV1Server())
    const result = await mcp.callTool('weather')
    expect(() => expect(result).toHaveContent({})).toThrow(/at least one field/i)
  })

  test('a field the part lacks does not match', async () => {
    const mcp = await mcpTest(createV1Server())
    const result = await mcp.callTool('weather')
    expect(() => expect(result).toHaveContent({ nope: undefined })).toThrow(/content/i)
  })

  test('matches nested values structurally', () => {
    const result = { content: [{ type: 'resource', resource: { uri: 'demo://x', text: 'y' } }] }
    expect(result).toHaveContent({ resource: { uri: 'demo://x', text: 'y' } })
  })
})

describe('toMatchOutputSchema misconfiguration', () => {
  test('.not does not pass when there is no schema to validate against', async () => {
    const mcp = await mcpTest(createV1Server())
    const result = await mcp.callTool('weather-bad')
    expect(() => expect(result).not.toMatchOutputSchema()).toThrow(/no output schema/i)
  })

  test('.not does not pass when there is no structuredContent', () => {
    const result = { content: [] }
    expect(() =>
      expect(result).not.toMatchOutputSchema({ type: 'object', required: ['x'] }),
    ).toThrow(/structuredContent/i)
  })

  test('draft-04 boolean exclusiveMinimum is honoured', () => {
    const result = { content: [], structuredContent: { n: 5 } }
    expect(() =>
      expect(result).toMatchOutputSchema({
        $schema: 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        properties: { n: { type: 'number', minimum: 5, exclusiveMinimum: true } },
      }),
    ).toThrow()
  })
})

describe('notification collector cleanup', () => {
  test('a timed-out waiter stops evaluating its predicate', async () => {
    const mcp = await mcpTest(createV1Server())
    const collector = mcp.notifications('notifications/progress')
    let calls = 0
    await expect(
      collector.waitFor(() => {
        calls++
        return false
      }, 50),
    ).rejects.toThrow(/timed out/i)
    const afterTimeout = calls
    await mcp.callTool('slow', { ms: 50 })
    expect(calls).toBe(afterTimeout)
  })

  test('close() abandons pending waiters without an unhandled rejection', async () => {
    const mcp = await mcpTest(createV1Server(), { autoClose: false })
    const collector = mcp.notifications('notifications/progress')
    collector.waitFor(() => false, 50)
    await mcp.close()
    await new Promise((r) => setTimeout(r, 120))
  })
})

describe('snapshot normalization', () => {
  test('_meta inside a user schema survives, unlike entry-level _meta', async () => {
    const server = new McpServer({ name: 'meta', version: '1.0.0' })
    server.registerTool(
      'has-nested-prop',
      {
        // Must not mention the property name: the description is serialized into
        // the manifest, which would satisfy a substring assertion on its own.
        description: 'Declares a reserved-looking property',
        inputSchema: { _meta: (await import('zod')).z.string() },
      },
      async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    )
    const mcp = await mcpTest(server)
    const manifest = (await toolManifest(mcp)) as Array<{
      inputSchema?: { properties?: Record<string, unknown> }
    }>
    expect(manifest[0]?.inputSchema?.properties).toHaveProperty('_meta')
  })

  test('pagination that never advances fails instead of hanging', async () => {
    const mcp = await mcpTest(createV1Server())
    const client = mcp.client as unknown as { listTools: () => Promise<unknown> }
    client.listTools = () => Promise.resolve({ tools: [{ name: 'a' }], nextCursor: 'same' })
    await expect(mcp.listTools()).rejects.toThrow(/repeated cursor|not converging/i)
  })
})
