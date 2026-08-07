import { describe, expect, test } from 'vitest'
import { serveHandler } from '../src/serve.js'

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
