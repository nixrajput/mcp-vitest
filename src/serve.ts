import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

/** The shape both SDK majors' HTTP handlers expose. */
export interface FetchHandler {
  fetch(req: Request): Response | Promise<Response>
}

export interface ServedHandler {
  /** Base URL, e.g. `http://127.0.0.1:53219`. No trailing slash. */
  url: string
  close(): Promise<void>
}

function toRequest(req: IncomingMessage, base: string): Request {
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
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        const response = await handler.fetch(toRequest(req, `http://${req.headers.host}`))
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
        if (response.body) {
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            res.write(chunk)
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
