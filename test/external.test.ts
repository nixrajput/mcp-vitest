import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

  // The first chunk must arrive before the second is produced, so a buffering
  // adapter deadlocks here instead of passing.
  test('streams response bodies incrementally', async () => {
    let releaseSecond: (() => void) | undefined
    const secondQueued = new Promise<void>((r) => {
      releaseSecond = r
    })
    const { url, close } = await serveHandler({
      fetch: async () =>
        new Response(
          new ReadableStream({
            async start(c) {
              c.enqueue(new TextEncoder().encode('data: a\n\n'))
              await secondQueued
              c.enqueue(new TextEncoder().encode('data: b\n\n'))
              c.close()
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    })
    try {
      const res = await fetch(url)
      expect(res.headers.get('content-type')).toBe('text/event-stream')
      const reader = res.body?.getReader()
      // Arrives while the server is still awaiting permission to send 'b'.
      const first = await reader?.read()
      expect(new TextDecoder().decode(first?.value)).toContain('data: a')
      releaseSecond?.()
      let rest = ''
      while (true) {
        const next = await reader?.read()
        if (!next || next.done) break
        rest += new TextDecoder().decode(next.value)
      }
      expect(rest).toContain('data: b')
    } finally {
      releaseSecond?.()
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

  // A completed request closes cleanly either way, so only the streaming case can
  // catch a regression in closeAllConnections.
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

  // Proves doubles answer across a process boundary rather than silently no-op.
  test('doubles answer across the pipe', async () => {
    const mcp = await spawn()
    mcp.onElicitation({ action: 'accept', content: { confirm: true } })
    expect(await mcp.callTool('ask', { question: 'Proceed?' })).toHaveTextContent(
      'answer: {"confirm":true}',
    )
  })

  // The SDK merges env over a small allowlist rather than inheriting the parent's.
  test('forwards env and cwd to the spawned child', async () => {
    const mcp = await mcpTest({
      command: 'node',
      args: [STDIO_SERVER],
      env: { MCP_VITEST_PROBE: 'forwarded', PATH: process.env.PATH ?? '' },
      cwd: tmpdir(),
    })
    const result = await mcp.callTool('spawn-info')
    expect(result).toHaveTextContent(/probe: forwarded/)
    expect(result).toHaveTextContent(`cwd: ${realpathSync(tmpdir())}`)
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
  // Without this a lifecycle matrix would label a 2025 run as [2026-07-28].
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

  // Asserts the handler answers, not merely that onRoots does not throw.
  test('roots doubles are served on the stdio lane', async () => {
    const mcp = await mcpTest({ command: 'node', args: [STDIO_SERVER] })
    mcp.onRoots([{ uri: 'file:///workspace' }])
    expect(await mcp.callTool('list-roots')).toHaveTextContent('roots: file:///workspace')
  })

  // Doubles are accepted on any revision: whether a remote can ask depends on the
  // server, not the era, and one that cannot says so in milliseconds.
  test('doubles are accepted on a legacy-held url connection', async () => {
    const { createMcpHandler } = await import('@modelcontextprotocol/server')
    const { createV2Server } = await import('./servers/v2.js')
    const served = await serveHandler(createMcpHandler(() => createV2Server()))
    try {
      const mcp = await mcpTest({ url: `${served.url}/mcp` }, { protocolVersion: '2025-11-25' })
      expect(() =>
        mcp.onElicitation({ action: 'accept', content: { confirm: true } }),
      ).not.toThrow()
      // This particular server is stateless and cannot ask, so it fails fast
      // and names the reason instead of hanging.
      const started = Date.now()
      const result = await mcp.callTool('ask', { question: 'Proceed?' })
      expect(result).toBeToolError(/did not declare the required capability/i)
      expect(Date.now() - started).toBeLessThan(2000)
      await mcp.close()
    } finally {
      await served.close()
    }
  })
})

describe('serveHandler header fidelity', () => {
  // entries() yields set-cookie once per value, so a fromEntries copy keeps only one.
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
