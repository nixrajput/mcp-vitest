import type { DoubleRegistry, ElicitationRequest, SamplingRequest } from "../doubles.js";
import type {
  McpLifecycle,
  McpToolResult,
  RawConnection,
  SdkClientLike,
  StdioServerSpec,
  UrlServerSpec,
} from "../types.js";
import { CLIENT_INFO } from "../types.js";
import { createNotificationBus } from "./bus.js";

/** Spawns a server over stdio. v1 client: it speaks the widest range of revisions. */
export async function connectStdio(
  spec: StdioServerSpec,
  registry: DoubleRegistry,
  lifecycle?: McpLifecycle,
): Promise<RawConnection> {
  // v1 tops out at 2025-11-25; accepting 2026 would silently run 2025 under that label.
  if (lifecycle === "2026-07-28") {
    throw new Error(
      "mcp-vitest: a stdio server is driven by the v1 SDK, which cannot serve the " +
        "2026-07-28 lifecycle; it negotiates 2025-11-25. Drop '2026-07-28' from " +
        "lifecycles, or reach the server over { url } instead.",
    );
  }
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

  const transport = new StdioClientTransport({
    command: spec.command,
    args: spec.args,
    env: spec.env,
    cwd: spec.cwd,
  });
  // Same wiring as the in-process v1 lane; a spawned server is still a v1 server.
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

  const bus = createNotificationBus(client);
  await client.connect(transport);

  let closed = false;
  return {
    client: client as unknown as SdkClientLike,
    onNotification: bus.onNotification,
    lifecycle,
    supports: { roots: true, serverInitiatedRequests: true },
    callTool: async (params, opts) =>
      (
        client as unknown as {
          callTool: (p: unknown, s: unknown, o: unknown) => Promise<McpToolResult>;
        }
      ).callTool(params, undefined, bus.requestOptions(opts)),
    close: async () => {
      if (closed) return;
      // Closing the client closes the transport, terminating the child.
      await client.close();
      closed = true;
    },
  };
}

/**
 * Connects to a running server over Streamable HTTP. Does not pin a revision:
 * the server is not ours and may implement any era, so negotiation probes.
 */
export async function connectUrl(
  spec: UrlServerSpec,
  registry: DoubleRegistry,
  lifecycle?: McpLifecycle,
): Promise<RawConnection> {
  const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");

  const transport = new StreamableHTTPClientTransport(new URL(spec.url), {
    requestInit: spec.headers ? { headers: spec.headers } : undefined,
  });
  const client = new Client(CLIENT_INFO, {
    capabilities: { sampling: {}, elicitation: {} },
    versionNegotiation: {
      mode:
        lifecycle === undefined
          ? "auto"
          : lifecycle === "2026-07-28"
            ? { pin: lifecycle }
            : "legacy",
    },
  });
  client.setRequestHandler("sampling/createMessage", async (req) => {
    const result = await registry.requireSampling()(req.params as unknown as SamplingRequest);
    return result as unknown as never;
  });
  client.setRequestHandler("elicitation/create", async (req) => {
    const result = await registry.requireElicitation()(req.params as unknown as ElicitationRequest);
    return result as unknown as never;
  });

  const bus = createNotificationBus(client);
  await client.connect(transport);

  let closed = false;
  return {
    client: client as unknown as SdkClientLike,
    onNotification: bus.onNotification,
    lifecycle,
    // Always true: whether a remote can ask depends on the server, not the revision,
    // and one that cannot fails in milliseconds rather than stalling.
    supports: { roots: false, serverInitiatedRequests: true },
    callTool: async (params, opts) =>
      (
        client as unknown as {
          callTool: (p: unknown, o: unknown) => Promise<McpToolResult>;
        }
      ).callTool(params, bus.requestOptions(opts)),
    close: async () => {
      if (closed) return;
      await client.close();
      closed = true;
    },
  };
}
