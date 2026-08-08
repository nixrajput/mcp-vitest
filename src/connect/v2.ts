import type { DoubleRegistry, ElicitationRequest, SamplingRequest } from "../doubles.js";
import type { McpLifecycle, McpToolResult, RawConnection, SdkClientLike } from "../types.js";
import { CLIENT_INFO } from "../types.js";
import { createNotificationBus } from "./bus.js";

// The client transport's fetch points at createMcpHandler. This is the only
// in-process route that can reach 2026-07-28, and only via the pin below:
// versionNegotiation defaults to 'legacy' over exactly the same plumbing.
const DEFAULT_LIFECYCLE: McpLifecycle = "2026-07-28";

export async function connectV2(
  createServer: () => unknown | Promise<unknown>,
  registry: DoubleRegistry,
  lifecycle: McpLifecycle = DEFAULT_LIFECYCLE,
): Promise<RawConnection> {
  const { createMcpHandler } = await import("@modelcontextprotocol/server");
  const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");

  const handler = createMcpHandler(createServer as never);
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp-vitest.test/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  // Pinned, not 'auto': auto downgrades silently, turning doubles into timeouts.
  const client = new Client(CLIENT_INFO, {
    capabilities: { sampling: {}, elicitation: {} },
    versionNegotiation: {
      mode: lifecycle === "2026-07-28" ? { pin: lifecycle } : "legacy",
    },
  });
  // Server-initiated requests arrive as input_required results; the SDK's driver
  // dispatches them here and retries the call.
  client.setRequestHandler("sampling/createMessage", async (req) => {
    const result = await registry.requireSampling()(req.params as unknown as SamplingRequest);
    return result as unknown as never;
  });
  client.setRequestHandler("elicitation/create", async (req) => {
    const result = await registry.requireElicitation()(req.params as unknown as ElicitationRequest);
    return result as unknown as never;
  });
  await client.connect(transport);

  // Progress only. A subscriptions/listen for list_changed is honored empty and
  // sends nothing even as the tool list changes - a server-side gap.
  const bus = createNotificationBus(client);

  let closed = false;
  return {
    client: client as unknown as SdkClientLike,
    onNotification: bus.onNotification,
    lifecycle,
    supports: { roots: false, serverInitiatedRequests: lifecycle === "2026-07-28" },
    // v2 dropped the resultSchema parameter: callTool(params, options?)
    callTool: async (params, opts) =>
      (
        client as unknown as {
          callTool: (p: unknown, o: unknown) => Promise<McpToolResult>;
        }
      ).callTool(params, bus.requestOptions(opts)),
    close: async () => {
      if (closed) return;
      // Close the handler even if the transport is gone; `closed` flips only on success.
      try {
        await client.close();
      } finally {
        await handler.close();
        closed = true;
      }
    },
  };
}
