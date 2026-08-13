import { describe, expect, test } from "vitest";
import { fakeAuthServer } from "../src/auth/fake-as.js";
import { decodeJwt, generateAuthKeys, signJwt } from "../src/auth/jwt.js";

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
});
