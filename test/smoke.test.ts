import { describe, expect, test } from 'vitest'

describe('sdk peers are importable', () => {
  test('v1 sdk exposes McpServer and InMemoryTransport', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    expect(McpServer).toBeTypeOf('function')
    expect(InMemoryTransport.createLinkedPair).toBeTypeOf('function')
  })

  test('v2 packages expose McpServer, Client, createMcpHandler', async () => {
    const serverPkg: Record<string, unknown> = await import('@modelcontextprotocol/server')
    const clientPkg: Record<string, unknown> = await import('@modelcontextprotocol/client')
    expect(serverPkg.McpServer).toBeTypeOf('function')
    expect(clientPkg.Client).toBeTypeOf('function')
    expect(clientPkg.StreamableHTTPClientTransport).toBeTypeOf('function')
    // createMcpHandler lives in @modelcontextprotocol/server per SDK docs/testing.md.
    // If this assertion fails, check @modelcontextprotocol/node and adjust
    // src/connect/v2.ts's import in Task 3 accordingly.
    expect(serverPkg.createMcpHandler).toBeTypeOf('function')
  })
})
