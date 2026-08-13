import {
  buildOAuthProtectedResourceMetadata,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  type OAuthTokenVerifier,
  requireBearerAuth,
} from "@modelcontextprotocol/server";
import { createV2Server } from "./v2.js";

/** Wraps the v2 echo fixture in bearer auth, backed by a fakeAuthServer(). */
export function createAuthedV2Handler(config: {
  verifier: OAuthTokenVerifier;
  issuer: string;
  requiredScopes?: string[];
}): { fetch(req: Request): Promise<Response> } {
  const handler = createMcpHandler(() => createV2Server());

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const resourceServerUrl = new URL("/mcp", url.origin);
    const prmUrl = getOAuthProtectedResourceMetadataUrl(resourceServerUrl);
    if (url.pathname === new URL(prmUrl).pathname) {
      return Response.json(
        buildOAuthProtectedResourceMetadata({
          oauthMetadata: {
            issuer: config.issuer,
            authorization_endpoint: `${config.issuer}/authorize`,
            token_endpoint: `${config.issuer}/token`,
            response_types_supported: ["code"],
          },
          resourceServerUrl,
        }),
      );
    }

    const authResult = await requireBearerAuth({
      verifier: config.verifier,
      requiredScopes: config.requiredScopes,
      resourceMetadataUrl: prmUrl,
    })(req);
    if (authResult instanceof Response) return authResult;

    return handler.fetch(req, { authInfo: authResult });
  }

  return { fetch };
}
