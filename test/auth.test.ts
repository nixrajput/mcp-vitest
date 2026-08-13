import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/client";
import { describe, expect, test, vi } from "vitest";
import { fakeAuthServer } from "../src/auth/fake-as.js";
import { expectAuthChallenge, fetchPrm, hostClientMetadata } from "../src/auth/index.js";
import { decodeJwt, generateAuthKeys, signJwt } from "../src/auth/jwt.js";
import { mcpTest } from "../src/index.js";
import { serveHandler } from "../src/serve.js";
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
      await expect(a.verifier.verifyAccessToken(b.mintToken())).rejects.toThrow();
    } finally {
      await a.close();
      await b.close();
    }
  });

  test("its verifier rejects an expired token", async () => {
    const as = await fakeAuthServer();
    try {
      await expect(as.verifier.verifyAccessToken(as.mintToken({ exp: 1 }))).rejects.toThrow();
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
      ).rejects.toThrow();
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
      ).rejects.toThrow();
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
