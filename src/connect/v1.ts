import type { DoubleRegistry } from "../doubles.js";
import type { McpLifecycle, McpToolResult, RawConnection, SdkClientLike } from "../types.js";
import { CLIENT_INFO } from "../types.js";
import { createNotificationBus } from "./bus.js";

// InMemoryTransport is the SDK's in-process path for the 2025 era. No negotiation
// knob: SDK 1.x tops out at 2025-11-25 and always lands there.
export async function connectV1(
  server: unknown,
  registry: DoubleRegistry,
  lifecycle?: McpLifecycle,
): Promise<RawConnection> {
  if (lifecycle === "2026-07-28") {
    throw new Error(
      "mcp-vitest: the v1 SDK cannot serve the 2026-07-28 lifecycle; it negotiates 2025-11-25. " +
        "Drop '2026-07-28' from lifecycles, or test it against a v2 server.",
    );
  }
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  // Advertised unconditionally: a server decides what to request during initialize,
  // before a test body can register doubles. No roots.listChanged - never sent.
  const client = new Client(CLIENT_INFO, {
    capabilities: { sampling: {}, elicitation: {}, roots: {} },
  });

  const { CreateMessageRequestSchema, ElicitRequestSchema, ListRootsRequestSchema } = await import(
    "@modelcontextprotocol/sdk/types.js"
  );
  client.setRequestHandler(
    CreateMessageRequestSchema,
    async (req) => registry.requireSampling()(req.params as never) as never,
  );
  client.setRequestHandler(
    ElicitRequestSchema,
    async (req) => registry.requireElicitation()(req.params as never) as never,
  );
  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: registry.requireRoots(),
  }));

  const connectable = server as {
    connect(t: unknown): Promise<void>;
    close?(): Promise<void>;
  };
  await Promise.all([connectable.connect(serverTransport), client.connect(clientTransport)]);

  const bus = createNotificationBus(client);

  let closed = false;
  return {
    client: client as unknown as SdkClientLike,
    onNotification: bus.onNotification,
    lifecycle,
    supports: { roots: true, serverInitiatedRequests: true },
    // v1 signature: callTool(params, resultSchema?, options?)
    callTool: async (params, opts) =>
      (
        client as unknown as {
          callTool: (p: unknown, s: unknown, o: unknown) => Promise<McpToolResult>;
        }
      ).callTool(params, undefined, bus.requestOptions(opts)),
    close: async () => {
      if (closed) return;
      // Close the server even if the transport is gone; `closed` flips only on success.
      try {
        await client.close();
      } finally {
        await connectable.close?.();
        closed = true;
      }
    },
  };
}
