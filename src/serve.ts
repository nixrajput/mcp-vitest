// Type-only, so these are erased. The runtime imports happen inside serveHandler:
// importing node:http at module scope would make every `import 'mcp-vitest'`
// pull in Node builtins, even for the in-process lanes that never serve HTTP.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Readable as NodeReadable } from 'node:stream'

/** The shape both SDK majors' HTTP handlers expose. */
export interface FetchHandler {
  fetch(req: Request): Response | Promise<Response>
}

export interface ServedHandler {
  /** Base URL, e.g. `http://127.0.0.1:53219`. No trailing slash. */
  url: string
  close(): Promise<void>
}

type ReadableCtor = { toWeb(stream: NodeReadable): unknown }

function toRequest(req: IncomingMessage, base: string, Readable: ReadableCtor): Request {
  const url = new URL(req.url ?? '/', base)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v)
    else if (Array.isArray(v)) for (const item of v) headers.append(k, item)
  }
  const method = req.method ?? 'GET'
  // GET/HEAD must not carry a body, and Node requires `duplex` whenever one is
  // streamed rather than buffered.
  const body = method === 'GET' || method === 'HEAD' ? undefined : (Readable.toWeb(req) as BodyInit)
  return new Request(url, { method, headers, body, duplex: 'half' } as RequestInit)
}

/**
 * Serves a fetch-style handler on an ephemeral loopback port so it can be tested
 * over real HTTP rather than in-process. Binds port 0, so parallel test files
 * never contend for a fixed port.
 */
export async function serveHandler(handler: FetchHandler): Promise<ServedHandler> {
  const { createServer } = await import('node:http')
  const { Readable } = await import('node:stream')
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        const response = await handler.fetch(toRequest(req, `http://${req.headers.host}`, Readable))
        // set-cookie is the one header Headers does not pre-join: entries()
        // yields it once per value, so Object.fromEntries would keep only the
        // last. Every other name arrives already joined.
        const outHeaders: Record<string, string | string[]> = Object.fromEntries(
          response.headers.entries(),
        )
        const cookies = response.headers.getSetCookie()
        if (cookies.length > 0) outHeaders['set-cookie'] = cookies
        res.writeHead(response.status, outHeaders)
        if (response.body) {
          // Read through an explicit reader rather than `for await`. The socket can
          // die mid-stream (closeAllConnections destroys it), and a stream that
          // never yields again would leave the read pending forever. Cancelling
          // the reader we hold settles it; cancelling the *body* cannot, because
          // iterating it already locked the stream.
          const reader = response.body.getReader()
          res.on('close', () => void reader.cancel().catch(() => {}))
          try {
            while (!res.destroyed) {
              const { done, value } = await reader.read()
              if (done) break
              res.write(value)
            }
          } finally {
            reader.releaseLock()
          }
        }
        res.end()
      } catch (err) {
        // A handler that throws must still answer: an unanswered socket would
        // hang the caller until its own timeout, with no indication why.
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
        res.end(String(err))
      }
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('mcp-vitest: serveHandler could not determine the bound port')
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // closeAllConnections first. close() alone waits for open connections to
        // end, and an MCP HTTP transport holds a streaming response open, so the
        // callback never fires: measured hanging indefinitely against a live SSE
        // stream, while a completed request closes cleanly either way.
        server.closeAllConnections()
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
