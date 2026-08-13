import { describe, expect, test } from "vitest";
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
