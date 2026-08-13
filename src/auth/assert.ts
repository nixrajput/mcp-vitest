import {
  extractResourceMetadataUrl,
  extractWWWAuthenticateParams,
} from "@modelcontextprotocol/client";
import { serveHandler } from "../serve.js";

/** Probes an MCP endpoint and asserts it challenges with a 401 + WWW-Authenticate. */
export async function expectAuthChallenge(
  url: string | URL,
): Promise<{ status: 401; challenge: Record<string, string>; prmUrl?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover" }),
  });
  if (res.status !== 401) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`Expected 401, got ${res.status}: ${body}`);
  }

  const parsed = extractWWWAuthenticateParams(res);
  const challenge: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) challenge[key] = String(value);
  }

  return { status: 401, challenge, prmUrl: extractResourceMetadataUrl(res)?.toString() };
}

/** Fetches a Protected Resource Metadata document and validates the RFC 9728 shape. */
export async function fetchPrm(prmUrl: string | URL): Promise<Record<string, unknown>> {
  const res = await fetch(prmUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch PRM document from ${prmUrl}: ${res.status}`);
  }
  const doc = (await res.json()) as Record<string, unknown>;
  if (doc.resource === undefined || doc.authorization_servers === undefined) {
    throw new Error(`Not a PRM document, missing resource/authorization_servers: ${prmUrl}`);
  }
  return doc;
}

/** Serves a client metadata document (CIMD) at a dereferenceable client_id URL. */
export async function hostClientMetadata(doc: {
  client_name: string;
  [k: string]: unknown;
}): Promise<{ url: string; close(): Promise<void> }> {
  const served = await serveHandler({ fetch: async () => Response.json(doc) });
  return { url: served.url, close: served.close };
}
