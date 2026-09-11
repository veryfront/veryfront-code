// CI-only security probe. Do not execute native/prototype tampering locally.
import "#veryfront/schemas/_test-setup.ts";
import { generateKeyPairSync, sign } from "node:crypto";
import { Buffer } from "node:buffer";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createHostedServiceAuth } from "#veryfront/agent/service/auth.ts";

it("rejects a real ordinary JWT when the shared prototype supplies a victim run ID", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", typ: "JWT" });
  const runId = "synthetic-victim-run";
  const ordinaryClaims = {
    userId: "synthetic-user",
    scope: ["read", "write", "delete"],
    exp: Math.floor(Date.now() / 1000) + 60,
  };
  const tokenFor = (claims: object) => {
    const body = `${header}.${encode(claims)}`;
    return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
  };
  const ordinary = { token: tokenFor(ordinaryClaims), runId };
  const authorized = { token: tokenFor({ ...ordinaryClaims, runId }), runId };
  const auth = createHostedServiceAuth({
    getConfig: () => ({
      VERYFRONT_API_URL: "https://api.example.test",
      OAUTH_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
      NODE_ENV: "production",
    }),
  });
  assertEquals(await auth.verifyRunCancellationToken(ordinary), false);
  assertEquals(await auth.verifyRunCancellationToken(authorized), true);

  const defineProperty = Object.defineProperty;
  const deleteProperty = Reflect.deleteProperty;
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "runId");
  let control: unknown;
  let denied: boolean | undefined;
  let allowed: boolean | undefined;
  try {
    defineProperty(Object.prototype, "runId", { value: runId, configurable: true, writable: true });
    // Demonstrate that ordinary property lookup sees the active inherited value.
    control = Reflect.get(ordinaryClaims, "runId");
    denied = await auth.verifyRunCancellationToken(ordinary);
    allowed = await auth.verifyRunCancellationToken(authorized);
  } finally {
    if (original) defineProperty(Object.prototype, "runId", original);
    else deleteProperty(Object.prototype, "runId");
  }
  assertEquals(control, runId);
  assertEquals(denied, false);
  assertEquals(allowed, true);
});
