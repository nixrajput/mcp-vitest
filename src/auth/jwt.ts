import { createSign, generateKeyPairSync, type KeyObject, randomUUID } from "node:crypto";

const b64url = (input: Buffer | string): string => Buffer.from(input).toString("base64url");

export function generateAuthKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = randomUUID();
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  return { privateKey, publicJwk: { ...jwk, kid, alg: "RS256" as const, use: "sig" as const } };
}

export function signJwt(
  privateKey: KeyObject,
  kid: string,
  claims: Record<string, unknown>,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  // iat/exp first so a caller can override either, which the expired-token test needs.
  const payload = b64url(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(privateKey).toString("base64url")}`;
}

export function decodeJwt(token: string) {
  const [h, p] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString()),
    payload: JSON.parse(Buffer.from(p, "base64url").toString()),
  };
}
