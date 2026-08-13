// Type-only here, imported for real inside serveHandler: a module-scope import
// would pull Node builtins into every `import 'mcp-vitest'`.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Readable as NodeReadable } from "node:stream";

/** The shape both SDK majors' HTTP handlers expose. */
export interface FetchHandler {
  fetch(req: Request): Response | Promise<Response>;
}

export interface ServedHandler {
  /** Base URL, e.g. `http://127.0.0.1:53219`. No trailing slash. */
  url: string;
  close(): Promise<void>;
}

type ReadableCtor = { toWeb(stream: NodeReadable): unknown };

function toRequest(req: IncomingMessage, base: string, Readable: ReadableCtor): Request {
  const url = new URL(req.url ?? "/", base);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) for (const item of v) headers.append(k, item);
  }
  const method = req.method ?? "GET";
  // Node requires `duplex` whenever a body is streamed rather than buffered.
  const body =
    method === "GET" || method === "HEAD" ? undefined : (Readable.toWeb(req) as BodyInit);
  return new Request(url, { method, headers, body, duplex: "half" } as RequestInit);
}

/**
 * Serves a fetch-style handler over real HTTP. Binds port 0 on loopback, so
 * parallel test files never contend for a fixed port.
 */
export async function serveHandler(handler: FetchHandler): Promise<ServedHandler> {
  const { createServer } = await import("node:http");
  const { Readable } = await import("node:stream");
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        const response = await handler.fetch(
          toRequest(req, `http://${req.headers.host}`, Readable),
        );
        // Client vanished during handler.fetch(): writeHead would throw and
        // nothing below would drain the body, so release the producer here.
        if (res.destroyed) {
          await response.body?.cancel().catch(() => {});
          return;
        }
        // set-cookie is the one header Headers does not pre-join; entries()
        // yields it once per value, so fromEntries alone would keep only the last.
        const outHeaders: Record<string, string | string[]> = Object.fromEntries(
          response.headers.entries(),
        );
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) outHeaders["set-cookie"] = cookies;
        res.writeHead(response.status, outHeaders);
        if (response.body) {
          // An explicit reader, not `for await`: when the socket dies mid-stream the
          // read must be cancellable, and `for await` locks the body against cancel.
          const reader = response.body.getReader();
          res.on("close", () => void reader.cancel().catch(() => {}));
          let drained = false;
          try {
            while (!res.destroyed) {
              const { done, value } = await reader.read();
              if (done) {
                drained = true;
                break;
              }
              res.write(value);
            }
          } finally {
            // Not drained means nobody will read the rest; release the producer.
            if (!drained) void reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        }
        res.end();
      } catch (err) {
        // A thrown handler must still answer, or the caller hangs to its own timeout.
        if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
        res.end(String(err));
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("mcp-vitest: serveHandler could not determine the bound port");
  }
  // Memoized so a second close resolves instead of rejecting ERR_SERVER_NOT_RUNNING, which
  // teardown reaches routinely: an afterEach plus a finally in the test both call it.
  let closed: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => {
      closed ??= new Promise<void>((resolve, reject) => {
        // close() alone waits for open connections, and an MCP transport holds a
        // stream open indefinitely, so the callback would never fire.
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      });
      return closed;
    },
  };
}
