import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/client";
import { describe, expect, test, vi } from "vitest";
import { fakeAuthServer } from "../src/auth/fake-as.js";
import { expectAuthChallenge, fetchPrm, hostClientMetadata } from "../src/auth/index.js";
import { decodeJwt, generateAuthKeys, signJwt } from "../src/auth/jwt.js";
import { mcpTest } from "../src/index.js";
import { serveHandler } from "../src/serve.js";
import { createV2Server } from "./servers/v2.js";
import { createAuthedV2Handler } from "./servers/v2-authed.js";

describe("jwt helpers", () => {
  test("signs and decodes an RS256 JWT", () => {
    const { privateKey, publicJwk } = generateAuthKeys();
    const token = signJwt(privateKey, publicJwk.kid, { sub: "user1", aud: "https://rs.test" });
    const { header, payload } = decodeJwt(token);
    expect(header).toMatchObject({ alg: "RS256", typ: "JWT", kid: publicJwk.kid });
    expect(payload).toMatchObject({ sub: "user1", aud: "https://rs.test" });
    expect(publicJwk).toMatchObject({ kty: "RSA", use: "sig", alg: "RS256" });
  });

  test("sets iat and exp so bearer auth accepts the token", () => {
    const { privateKey, publicJwk } = generateAuthKeys();
    const { payload } = decodeJwt(signJwt(privateKey, publicJwk.kid, {}));
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
    expect(payload.exp as number).toBeGreaterThan(payload.iat as number);
  });

  test("caller claims override the defaults", () => {
    const { privateKey, publicJwk } = generateAuthKeys();
    const { payload } = decodeJwt(signJwt(privateKey, publicJwk.kid, { exp: 1 }));
    expect(payload.exp).toBe(1);
  });
});

describe("fakeAuthServer", () => {
  test("serves AS metadata and JWKS", async () => {
    const as = await fakeAuthServer();
    try {
      const meta = await (
        await fetch(`${as.issuer}/.well-known/oauth-authorization-server`)
      ).json();
      expect(meta).toMatchObject({
        issuer: as.issuer,
        jwks_uri: as.jwksUrl,
        token_endpoint: `${as.issuer}/token`,
        client_id_metadata_document_supported: true,
      });
      const jwks = await (await fetch(as.jwksUrl)).json();
      expect(jwks.keys[0]).toMatchObject({ kty: "RSA", use: "sig", alg: "RS256" });
    } finally {
      await as.close();
    }
  });

  test("token endpoint honours the RFC 8707 resource param", async () => {
    const as = await fakeAuthServer();
    try {
      const res = await fetch(`${as.issuer}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials&client_id=test&resource=https%3A%2F%2Frs.example",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ token_type: "Bearer" });
      expect(decodeJwt(body.access_token).payload).toMatchObject({
        iss: as.issuer,
        aud: "https://rs.example",
      });
    } finally {
      await as.close();
    }
  });

  test("clientCredentials throws a diagnosable error when the token endpoint refuses", async () => {
    const as = await fakeAuthServer();
    try {
      // The AS truly refuses an unsupported grant with 400, proving the endpoint's own contract.
      const direct = await fetch(`${as.issuer}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=authorization_code",
      });
      expect(direct.status).toBe(400);

      // clientCredentials hardcodes grant_type=client_credentials, so its own request can
      // never hit that refusal for real; stub the one fetch call to reach the new guards.
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid_client" }), { status: 400 }),
      );
      await expect(as.clientCredentials()).rejects.toThrow(/400/);

      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ token_type: "Bearer" })));
      await expect(as.clientCredentials()).rejects.toThrow(/access_token/);

      fetchSpy.mockRestore();
    } finally {
      await as.close();
    }
  });

  test("its verifier accepts a minted token and always sets expiresAt", async () => {
    const as = await fakeAuthServer();
    try {
      const info = await as.verifier.verifyAccessToken(as.mintToken({ scope: "read write" }));
      expect(info.scopes).toEqual(["read", "write"]);
      // Bearer auth rejects tokens whose expiresAt is unset, so this is load-bearing.
      expect(typeof info.expiresAt).toBe("number");
    } finally {
      await as.close();
    }
  });

  test("its verifier rejects a token signed by a different instance", async () => {
    const [a, b] = [await fakeAuthServer(), await fakeAuthServer()];
    try {
      await expect(a.verifier.verifyAccessToken(b.mintToken())).rejects.toThrow(/signature/i);
    } finally {
      await a.close();
      await b.close();
    }
  });

  test("its verifier rejects an expired token", async () => {
    const as = await fakeAuthServer();
    try {
      await expect(as.verifier.verifyAccessToken(as.mintToken({ exp: 1 }))).rejects.toThrow(
        /expired/i,
      );
    } finally {
      await as.close();
    }
  });

  // The SDK's own OAuthMetadataSchema requires authorization_endpoint; a metadata
  // document that only satisfies our own tests can still fail real discovery.
  test("its metadata document is accepted by the SDK's discovery function", async () => {
    const as = await fakeAuthServer();
    try {
      const metadata = await discoverAuthorizationServerMetadata(as.issuer);
      expect(metadata).toMatchObject({
        issuer: as.issuer,
        authorization_endpoint: `${as.issuer}/authorize`,
      });
    } finally {
      await as.close();
    }
  });

  test("its authorize endpoint redirects with a code and the echoed state", async () => {
    const as = await fakeAuthServer();
    try {
      const authorizeUrl = new URL(`${as.issuer}/authorize`);
      authorizeUrl.searchParams.set("redirect_uri", "https://client.example/cb");
      authorizeUrl.searchParams.set("state", "xyz");
      const res = await fetch(authorizeUrl, { redirect: "manual" });
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("location") ?? "");
      expect(location.origin + location.pathname).toBe("https://client.example/cb");
      expect(location.searchParams.get("state")).toBe("xyz");
      expect(location.searchParams.get("code")).toBeTruthy();
    } finally {
      await as.close();
    }
  });
});

describe("authenticated server", () => {
  test("a valid token connects and calls tools", async () => {
    const as = await fakeAuthServer();
    const served = await serveHandler(
      createAuthedV2Handler({ verifier: as.verifier, issuer: as.issuer }),
    );
    try {
      const mcp = await mcpTest(
        { url: `${served.url}/mcp` },
        { auth: { token: as.mintToken({ aud: `${served.url}/mcp` }) } },
      );
      await expect(mcp).toHaveTool("echo");
      const r = await mcp.callTool("echo", { message: "hi" });
      expect(r.content[0].text).toBe("echo: hi");
    } finally {
      await served.close();
      await as.close();
    }
  });

  test("no token is refused", async () => {
    const as = await fakeAuthServer();
    const served = await serveHandler(
      createAuthedV2Handler({ verifier: as.verifier, issuer: as.issuer }),
    );
    try {
      await expect(mcpTest({ url: `${served.url}/mcp` })).rejects.toThrow(/401|unauthor/i);
    } finally {
      await served.close();
      await as.close();
    }
  });

  test("auth.headers is merged verbatim", async () => {
    const as = await fakeAuthServer();
    const served = await serveHandler(
      createAuthedV2Handler({ verifier: as.verifier, issuer: as.issuer }),
    );
    try {
      const mcp = await mcpTest(
        { url: `${served.url}/mcp` },
        { auth: { headers: { authorization: `Bearer ${as.mintToken()}` } } },
      );
      await expect(mcp).toHaveTool("echo");
    } finally {
      await served.close();
      await as.close();
    }
  });

  test("auth.token wins over a same-name spec header regardless of case", async () => {
    const [as, other] = [await fakeAuthServer(), await fakeAuthServer()];
    const served = await serveHandler(
      createAuthedV2Handler({ verifier: as.verifier, issuer: as.issuer }),
    );
    try {
      const mcp = await mcpTest(
        {
          url: `${served.url}/mcp`,
          // Wrong-signature token from a different AS; must be overridden, not merged.
          headers: { authorization: `Bearer ${other.mintToken()}` },
        },
        { auth: { token: as.mintToken({ aud: `${served.url}/mcp` }) } },
      );
      await expect(mcp).toHaveTool("echo");
    } finally {
      await served.close();
      await as.close();
      await other.close();
    }
  });
});

describe("rejection cases", () => {
  const authedFor = async (as: Awaited<ReturnType<typeof fakeAuthServer>>, scopes?: string[]) =>
    serveHandler(
      createAuthedV2Handler({ verifier: as.verifier, issuer: as.issuer, requiredScopes: scopes }),
    );

  test("a token signed by another authorization server is refused", async () => {
    const [as, other] = [await fakeAuthServer(), await fakeAuthServer()];
    const served = await authedFor(as);
    try {
      await expect(
        mcpTest({ url: `${served.url}/mcp` }, { auth: { token: other.mintToken() } }),
      ).rejects.toThrow(/HTTP 401/);
    } finally {
      await served.close();
      await as.close();
      await other.close();
    }
  });

  test("an expired token is refused", async () => {
    const as = await fakeAuthServer();
    const served = await authedFor(as);
    try {
      await expect(
        mcpTest({ url: `${served.url}/mcp` }, { auth: { token: as.mintToken({ exp: 1 }) } }),
      ).rejects.toThrow(/HTTP 401/);
    } finally {
      await served.close();
      await as.close();
    }
  });

  test("a malformed bearer token gives 401, not 500", async () => {
    const as = await fakeAuthServer();
    const served = await authedFor(as);
    try {
      for (const token of ["garbage", "a.b"]) {
        const res = await fetch(`${served.url}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover" }),
        });
        expect(res.status).toBe(401);
      }
    } finally {
      await served.close();
      await as.close();
    }
  });

  test("a missing scope gives 403, not 401", async () => {
    const as = await fakeAuthServer();
    const served = await authedFor(as, ["admin"]);
    try {
      const res = await fetch(`${served.url}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${as.mintToken({ scope: "read" })}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover" }),
      });
      expect(res.status).toBe(403);
      expect(res.headers.get("www-authenticate") ?? "").toMatch(/insufficient_scope/);
    } finally {
      await served.close();
      await as.close();
    }
  });

  test("no token gives 401 whose challenge names the PRM document", async () => {
    const as = await fakeAuthServer();
    const served = await authedFor(as);
    try {
      const res = await fetch(`${served.url}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover" }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate") ?? "").toMatch(/resource_metadata/);
    } finally {
      await served.close();
      await as.close();
    }
  });
});

describe("auth assertions", () => {
  test("the challenge exposes a PRM URL naming the authorization server", async () => {
    const as = await fakeAuthServer();
    const served = await serveHandler(
      createAuthedV2Handler({ verifier: as.verifier, issuer: as.issuer }),
    );
    try {
      const challenge = await expectAuthChallenge(`${served.url}/mcp`);
      expect(challenge.status).toBe(401);
      expect(challenge.prmUrl).toBeDefined();
      const prm = await fetchPrm(challenge.prmUrl!);
      expect(JSON.stringify(prm.authorization_servers)).toContain(as.issuer);
    } finally {
      await served.close();
      await as.close();
    }
  });

  test("expectAuthChallenge throws when the endpoint does not challenge", async () => {
    const served = await serveHandler({ fetch: async () => new Response("ok") });
    try {
      await expect(expectAuthChallenge(served.url)).rejects.toThrow(/expected 401/i);
    } finally {
      await served.close();
    }
  });

  test("hostClientMetadata serves a CIMD document", async () => {
    const hosted = await hostClientMetadata({ client_name: "mcp-vitest tests" });
    try {
      const res = await fetch(hosted.url);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect((await res.json()).client_name).toBe("mcp-vitest tests");
    } finally {
      await hosted.close();
    }
  });
});

describe("end-to-end authorization flow", () => {
  test("the SDK client discovers metadata and exchanges for a token", async () => {
    const as = await fakeAuthServer();
    const served = await serveHandler(
      createAuthedV2Handler({ verifier: as.verifier, issuer: as.issuer }),
    );
    const cimd = await hostClientMetadata({
      client_name: "mcp-vitest tests",
      redirect_uris: ["http://127.0.0.1:0/callback"],
    });
    try {
      // The challenge is the discovery entry point a real client follows.
      const challenge = await expectAuthChallenge(`${served.url}/mcp`);
      const prm = await fetchPrm(challenge.prmUrl!);
      expect(prm.authorization_servers).toContain(as.issuer);

      const { discoverAuthorizationServerMetadata } = await import("@modelcontextprotocol/client");
      const meta = await discoverAuthorizationServerMetadata(as.issuer);
      expect(meta).toMatchObject({ client_id_metadata_document_supported: true });

      // client_id is a CIMD URL, not a registered id: DCR is deprecated as of 2026-07-28.
      const token = await as.clientCredentials(cimd.url);
      const mcp = await mcpTest({ url: `${served.url}/mcp` }, { auth: { token } });
      await expect(mcp).toHaveTool("echo");
    } finally {
      await cimd.close();
      await served.close();
      await as.close();
    }
  });
});

describe("metadata honesty", () => {
  test("every advertised grant type is one the token endpoint accepts", async () => {
    const as = await fakeAuthServer();
    try {
      const metadata = await discoverAuthorizationServerMetadata(as.issuer);
      const advertised = metadata?.grant_types_supported ?? [];
      expect(advertised.length).toBeGreaterThan(0);

      const rejected: string[] = [];
      for (const grant of advertised) {
        const res = await fetch(`${as.issuer}/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: grant, client_id: "test-client" }),
        });
        if (!res.ok) rejected.push(grant);
      }
      expect(rejected).toEqual([]);
    } finally {
      await as.close();
    }
  });
});

describe("audience and issuer", () => {
  test("a URL audience is reported as AuthInfo.resource", async () => {
    const as = await fakeAuthServer();
    try {
      const info = await as.verifier.verifyAccessToken(
        as.mintToken({ aud: "https://api.example.com/mcp" }),
      );
      expect(info.resource?.toString()).toBe("https://api.example.com/mcp");
    } finally {
      await as.close();
    }
  });

  test("a non-URL audience leaves resource unset", async () => {
    const as = await fakeAuthServer();
    try {
      const info = await as.verifier.verifyAccessToken(as.mintToken({ aud: "some-client-id" }));
      expect(info.resource).toBeUndefined();
    } finally {
      await as.close();
    }
  });

  test("with an audience configured, a token for another resource is refused", async () => {
    const as = await fakeAuthServer({ audience: "https://api.example.com/mcp" });
    try {
      await expect(
        as.verifier.verifyAccessToken(as.mintToken({ aud: "https://other.example/mcp" })),
      ).rejects.toThrow(/audience/i);
      await expect(as.verifier.verifyAccessToken(as.mintToken({}))).rejects.toThrow(/audience/i);
      const ok = await as.verifier.verifyAccessToken(
        as.mintToken({ aud: "https://api.example.com/mcp" }),
      );
      expect(ok.resource?.toString()).toBe("https://api.example.com/mcp");
    } finally {
      await as.close();
    }
  });

  test("without an audience configured, any audience is accepted", async () => {
    const as = await fakeAuthServer();
    try {
      const info = await as.verifier.verifyAccessToken(as.mintToken({ aud: "https://any/mcp" }));
      expect(info.token).toBeTypeOf("string");
    } finally {
      await as.close();
    }
  });

  test("a token claiming a foreign issuer is refused", async () => {
    const as = await fakeAuthServer();
    try {
      await expect(
        as.verifier.verifyAccessToken(as.mintToken({ iss: "https://evil.example" })),
      ).rejects.toThrow(/issuer/i);
    } finally {
      await as.close();
    }
  });

  test("a not-yet-valid token is refused", async () => {
    const as = await fakeAuthServer();
    try {
      const future = Math.floor(Date.now() / 1000) + 3600;
      await expect(as.verifier.verifyAccessToken(as.mintToken({ nbf: future }))).rejects.toThrow(
        /not yet valid/i,
      );
    } finally {
      await as.close();
    }
  });
});

describe("issuerPath and teardown", () => {
  test("the SDK discovers metadata for a path-scoped issuer", async () => {
    const as = await fakeAuthServer({ issuerPath: "/tenant1" });
    try {
      expect(as.issuer.endsWith("/tenant1")).toBe(true);
      const metadata = await discoverAuthorizationServerMetadata(as.issuer);
      expect(metadata?.issuer).toBe(as.issuer);
      expect(metadata?.token_endpoint).toBe(`${as.issuer}/token`);
    } finally {
      await as.close();
    }
  });

  test("close is idempotent, as a finally plus an afterEach both call it", async () => {
    const as = await fakeAuthServer();
    await as.close();
    await expect(as.close()).resolves.toBeUndefined();
  });
});

describe("credential handling", () => {
  test("an invalid auth header does not put the credential in the error", async () => {
    const secret = "sk-live-SECRET\r\nX-Injected: 1";
    const attempt = mcpTest({ url: "http://127.0.0.1:1/mcp" }, { auth: { token: secret } });
    await expect(attempt).rejects.toThrow(/invalid value/);
    await expect(attempt).rejects.not.toThrow(/sk-live-SECRET/);
  });
});

describe("auth on a lane that cannot send it", () => {
  test("an in-process server rejects rather than connecting with no credential", async () => {
    await expect(mcpTest(() => createV2Server(), { auth: { token: "unused" } })).rejects.toThrow(
      /only sent to a URL server/,
    );
  });

  test("a stdio spec rejects too", async () => {
    await expect(
      mcpTest({ command: "node", args: ["-e", ""] }, { auth: { token: "unused" } }),
    ).rejects.toThrow(/only sent to a URL server/);
  });
});
