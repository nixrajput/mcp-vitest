import { createPublicKey, createVerify, randomUUID } from "node:crypto";
import {
  type AuthInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { serveHandler } from "../serve.js";
import { decodeJwt, generateAuthKeys, signJwt } from "./jwt.js";

export interface FakeAuthServer {
  issuer: string;
  jwksUrl: string;
  verifier: OAuthTokenVerifier;
  mintToken(claims?: Record<string, unknown>): string;
  clientCredentials(clientId?: string): Promise<string>;
  close(): Promise<void>;
}

/** Spins up a real HTTP authorization server backed by its own RS256 keypair. */
export async function fakeAuthServer(options?: { issuerPath?: string }): Promise<FakeAuthServer> {
  const { privateKey, publicJwk } = generateAuthKeys();
  const publicKey = createPublicKey({ key: publicJwk, format: "jwk" });
  const prefix = options?.issuerPath ?? "";

  let issuer = "";
  const metadataDoc = () => ({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    jwks_uri: `${issuer}/jwks.json`,
    token_endpoint: `${issuer}/token`,
    // Only what /token will actually redeem. /authorize still answers with a code, which is
    // what response_types_supported describes, but that code is not exchangeable - so claiming
    // the authorization_code grant here would send a client to a guaranteed 400.
    grant_types_supported: ["client_credentials"],
    response_types_supported: ["code"],
    client_id_metadata_document_supported: true,
  });

  const served = await serveHandler({
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (
        pathname === `${prefix}/.well-known/oauth-authorization-server` ||
        pathname === `${prefix}/.well-known/openid-configuration`
      ) {
        return Response.json(metadataDoc());
      }
      if (pathname === `${prefix}/jwks.json`) {
        return Response.json({ keys: [publicJwk] });
      }
      if (req.method === "GET" && pathname === `${prefix}/authorize`) {
        const { searchParams } = new URL(req.url);
        const redirectUri = searchParams.get("redirect_uri");
        const state = searchParams.get("state");
        if (!redirectUri || !state) {
          const err = new OAuthError(
            OAuthErrorCode.InvalidRequest,
            "redirect_uri and state are required",
          );
          return Response.json(err.toResponseObject(), { status: 400 });
        }
        // authorization_code is deliberately unimplemented, so this code proves only
        // the redirect contract, not the grant - it is well-formed but not redeemable.
        const code = randomUUID();
        const redirect = new URL(redirectUri);
        redirect.searchParams.set("code", code);
        redirect.searchParams.set("state", state);
        return Response.redirect(redirect, 302);
      }
      if (req.method === "POST" && pathname === `${prefix}/token`) {
        const params = new URLSearchParams(await req.text());
        if (params.get("grant_type") !== "client_credentials") {
          const err = new OAuthError(
            OAuthErrorCode.UnsupportedGrantType,
            "only client_credentials is supported",
          );
          return Response.json(err.toResponseObject(), { status: 400 });
        }
        const resource = params.get("resource");
        const claims: Record<string, unknown> = {
          iss: issuer,
          client_id: params.get("client_id") ?? "test-client",
        };
        if (resource) claims.aud = resource;
        return Response.json({
          access_token: signJwt(privateKey, publicJwk.kid, claims),
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  issuer = `${served.url}${prefix}`;

  const verifier: OAuthTokenVerifier = {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const segments = token.split(".");
      if (segments.length !== 3) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "token is not a well-formed JWT");
      }
      const [header, payload, signature] = segments;
      let verified: boolean;
      try {
        verified = createVerify("RSA-SHA256")
          .update(`${header}.${payload}`)
          .verify(publicKey, signature, "base64url");
      } catch (err) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, `token could not be verified: ${err}`);
      }
      if (!verified) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "signature verification failed");
      }
      let claims: Record<string, unknown>;
      try {
        claims = decodeJwt(token).payload;
      } catch (err) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, `token could not be decoded: ${err}`);
      }
      const now = Math.floor(Date.now() / 1000);
      if (typeof claims.exp !== "number" || claims.exp < now) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "token expired");
      }
      const scope = typeof claims.scope === "string" ? claims.scope : "";
      return {
        token,
        clientId: (claims.client_id as string | undefined) ?? "test-client",
        scopes: scope.length > 0 ? scope.split(/\s+/) : [],
        // requireBearerAuth rejects any token whose expiresAt is unset, so this must always be set.
        expiresAt: claims.exp,
      };
    },
  };

  return {
    issuer,
    jwksUrl: `${issuer}/jwks.json`,
    verifier,
    mintToken(claims = {}) {
      return signJwt(privateKey, publicJwk.kid, { iss: issuer, ...claims });
    },
    async clientCredentials(clientId = "test-client") {
      const res = await fetch(`${issuer}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}`,
      });
      const bodyText = await res.text();
      if (!res.ok) {
        throw new Error(`clientCredentials: token endpoint returned ${res.status}: ${bodyText}`);
      }
      const body = JSON.parse(bodyText) as { access_token?: unknown };
      if (typeof body.access_token !== "string") {
        throw new Error(
          `clientCredentials: token endpoint response has no access_token: ${bodyText}`,
        );
      }
      return body.access_token;
    },
    close: served.close,
  };
}
