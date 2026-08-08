import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { mcpTest } from '../src/index.js'
import { serveHandler } from '../src/serve.js'

// Absolute, so the suite does not depend on the process working directory.
const STDIO_SERVER = fileURLToPath(new URL('./servers/stdio-server.mjs', import.meta.url))

describe('serveHandler', () => {
  test('serves a fetch handler on a real port', async () => {
    const { url, close } = await serveHandler({
      fetch: async (req) => new Response(`hello ${new URL(req.url).pathname}`),
    })
    try {
      const res = await fetch(new URL('/x', url))
      expect(await res.text()).toBe('hello /x')
    } finally {
      await close()
    }
  })

  test('streams response bodies', async () => {
    const { url, close } = await serveHandler({
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('data: a\n\n'))
              c.close()
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    })
    try {
      const res = await fetch(url)
      expect(res.headers.get('content-type')).toBe('text/event-stream')
      expect(await res.text()).toContain('data: a')
    } finally {
      await close()
    }
  })

  test('forwards method, headers, and request body', async () => {
    let seen: { method: string; auth: string | null; body: string } | undefined
    const { url, close } = await serveHandler({
      fetch: async (req) => {
        seen = {
          method: req.method,
          auth: req.headers.get('authorization'),
          body: await req.text(),
        }
        return new Response('ok')
      },
    })
    try {
      await fetch(url, {
        method: 'POST',
        headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
        body: '{"a":1}',
      })
      expect(seen).toEqual({ method: 'POST', auth: 'Bearer t', body: '{"a":1}' })
    } finally {
      await close()
    }
  })

  test('a throwing handler answers 500 rather than hanging', async () => {
    const { url, close } = await serveHandler({
      fetch: async () => {
        throw new Error('boom')
      },
    })
    try {
      const res = await fetch(url)
      expect(res.status).toBe(500)
    } finally {
      await close()
    }
  })

  test('close() releases the port', async () => {
    const { url, close } = await serveHandler({ fetch: async () => new Response('one') })
    await close()
    await expect(fetch(url, { signal: AbortSignal.timeout(2000) })).rejects.toThrow()
  })

  // The completed-request case above closes cleanly with or without
  // closeAllConnections, so it cannot catch a regression there. An MCP HTTP
  // transport holds a streaming response open, and close() alone hangs forever
  // on one - so this is the case that has to be pinned.
  test('close() does not hang on a live stream', async () => {
    const { url, close } = await serveHandler({
      fetch: async () =>
        new Response(
          // enqueues, then never closes: the connection stays open
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('data: open\n\n'))
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    })
    const res = await fetch(url)
    const reader = res.body?.getReader()
    await reader?.read()
    await expect(
      Promise.race([
        close().then(() => 'closed'),
        new Promise((r) => setTimeout(() => r('hung'), 3000)),
      ]),
    ).resolves.toBe('closed')
    await reader?.cancel().catch(() => {})
  }, 10_000)
})

describe('stdio transport', () => {
  const spawn = () => mcpTest({ command: 'node', args: [STDIO_SERVER] })

  test('spawns and tests an external stdio server', async () => {
    const mcp = await spawn()
    expect(mcp.kind).toBe('external')
    await expect(mcp).toHaveTool('echo')
    expect(await mcp.callTool('echo', { message: 'proc' })).toHaveTextContent('echo: proc')
  })

  test('the rest of the harness works across the process boundary', async () => {
    const mcp = await spawn()
    await expect(mcp).toHaveResource('demo://greeting')
    const { contents } = await mcp.readResource('demo://greeting')
    expect(contents[0]?.text).toBe('hello')
  })

  // The plan stubbed notifications and doubles out for stdio. Both work over a
  // real pipe, and asserting it here stops either becoming a silent no-op.
  test('doubles answer across the pipe', async () => {
    const mcp = await spawn()
    mcp.onElicitation({ action: 'accept', content: { confirm: true } })
    expect(await mcp.callTool('ask', { question: 'Proceed?' })).toHaveTextContent(
      'answer: {"confirm":true}',
    )
  })

  test('an unspawnable command fails with a clear error', async () => {
    // No bare toThrow(): that passes on any error at all, so 'clear' goes untested.
    await expect(mcpTest({ command: 'definitely-not-a-real-binary-xyz' })).rejects.toThrow(
      /definitely-not-a-real-binary-xyz|ENOENT|spawn/i,
    )
  })
})

describe('url transport', () => {
  async function serveV2() {
    const { createMcpHandler } = await import('@modelcontextprotocol/server')
    const { createV2Server } = await import('./servers/v2.js')
    return serveHandler(createMcpHandler(() => createV2Server()))
  }

  test('tests a served v2 server over real HTTP', async () => {
    const served = await serveV2()
    try {
      const mcp = await mcpTest({ url: `${served.url}/mcp` })
      expect(mcp.kind).toBe('external')
      await expect(mcp).toHaveTool('echo')
      expect(await mcp.callTool('echo', { message: 'net' })).toHaveTextContent('echo: net')
      await mcp.close()
    } finally {
      await served.close()
    }
  })

  test('forwards custom headers to the server', async () => {
    const seen: Array<string | null> = []
    const served = await serveHandler({
      fetch: async (req) => {
        seen.push(req.headers.get('x-test-token'))
        return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } })
      },
    })
    try {
      await mcpTest({
        url: `${served.url}/mcp`,
        headers: { 'x-test-token': 'abc123' },
      }).catch(() => {})
      expect(seen.some((v) => v === 'abc123')).toBe(true)
    } finally {
      await served.close()
    }
  })

  test('an unreachable url fails rather than hanging', async () => {
    await expect(mcpTest({ url: 'http://127.0.0.1:1/mcp' })).rejects.toThrow()
  }, 15_000)
})

describe('external lane guards', () => {
  // Regression for the worst shape a test harness can ship: before this, a
  // lifecycle matrix over a spawned server ran both variants at 2025-11-25 and
  // printed one of them as [2026-07-28] next to a passing test.
  test('a stdio server refuses the 2026 lifecycle', async () => {
    await expect(
      mcpTest({ command: 'node', args: [STDIO_SERVER] }, { protocolVersion: '2026-07-28' }),
    ).rejects.toThrow(/cannot serve the 2026-07-28 lifecycle/)
  })

  test('a stdio server reports the lifecycle it was held to', async () => {
    const mcp = await mcpTest(
      { command: 'node', args: [STDIO_SERVER] },
      { protocolVersion: '2025-11-25' },
    )
    expect(mcp.lifecycle).toBe('2025-11-25')
  })

  test('roots doubles are refused on the url lane', async () => {
    const { createMcpHandler } = await import('@modelcontextprotocol/server')
    const { createV2Server } = await import('./servers/v2.js')
    const served = await serveHandler(createMcpHandler(() => createV2Server()))
    try {
      const mcp = await mcpTest({ url: `${served.url}/mcp` })
      expect(() => mcp.onRoots([{ uri: 'file:///x' }])).toThrow(
        /does not advertise the roots capability/,
      )
      await mcp.close()
    } finally {
      await served.close()
    }
  })

  // Not just 'does not throw': the stdio fixture has a list-roots tool, so this
  // asserts the registered handler actually answers across the pipe.
  test('roots doubles are served on the stdio lane', async () => {
    const mcp = await mcpTest({ command: 'node', args: [STDIO_SERVER] })
    mcp.onRoots([{ uri: 'file:///workspace' }])
    expect(await mcp.callTool('list-roots')).toHaveTextContent('roots: file:///workspace')
  })

  // The gap the capability record closes: a url connection explicitly held to a
  // 2025 revision cannot receive server-initiated requests at all, so a double
  // registered there would be stored and never invoked.
  test('doubles are refused on a legacy-held url connection', async () => {
    const { createMcpHandler } = await import('@modelcontextprotocol/server')
    const { createV2Server } = await import('./servers/v2.js')
    const served = await serveHandler(createMcpHandler(() => createV2Server()))
    try {
      const mcp = await mcpTest({ url: `${served.url}/mcp` }, { protocolVersion: '2025-11-25' })
      expect(() => mcp.onElicitation({ action: 'accept' })).toThrow(
        /needs a connection that can carry server-initiated/,
      )
      await mcp.close()
    } finally {
      await served.close()
    }
  })
})

describe('serveHandler header fidelity', () => {
  // Headers.entries() yields set-cookie once per value and Object.fromEntries
  // keeps only the last, so a naive copy silently drops all but one cookie.
  // It is the one header Headers does not pre-join, and exactly what an
  // auth-protected server sets.
  test('preserves multiple set-cookie headers', async () => {
    const { url, close } = await serveHandler({
      fetch: async () => {
        const h = new Headers()
        h.append('set-cookie', 'a=1; Path=/')
        h.append('set-cookie', 'b=2; Path=/')
        return new Response('ok', { headers: h })
      },
    })
    try {
      const res = await fetch(url)
      expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
    } finally {
      await close()
    }
  })
})
