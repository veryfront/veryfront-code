import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { isProxyTrusted } from "./proxy-trust.ts";

const ENV_KEY = "VERYFRONT_TRUST_FORWARDED_HEADERS";

async function mintFreshDispatchJws(): Promise<string> {
  const keyPair = (await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64urlEncode(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const encodedPayload = base64urlEncode(JSON.stringify({
    iss: "veryfront-api",
    aud: "demo-project",
    sub: "dispatch-proxy-trust",
    project_id: "proj-1",
    platform: "slack",
    body_sha256: "dispatch-body-hash",
    iat: now,
    exp: now + 60,
  }));
  const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, signingInput);
  return `${encodedHeader}.${encodedPayload}.${base64urlEncodeBytes(new Uint8Array(signature))}`;
}

describe("server/utils/proxy-trust", () => {
  let previousEnv: string | undefined;

  beforeEach(() => {
    previousEnv = Deno.env.get(ENV_KEY);
    Deno.env.delete(ENV_KEY);
  });

  afterEach(() => {
    if (previousEnv === undefined) {
      Deno.env.delete(ENV_KEY);
    } else {
      Deno.env.set(ENV_KEY, previousEnv);
    }
  });

  it("fails closed without an explicit trusted-proxy topology", async () => {
    assertEquals(await isProxyTrusted(new Request("https://runtime.example/")), false);
  });

  it("does not promote a fresh signed dispatch credential into generic proxy trust", async () => {
    const jws = await mintFreshDispatchJws();
    const request = new Request("https://runtime.example/channels/invoke", {
      method: "POST",
      headers: {
        "x-veryfront-dispatch-jws": jws,
        "x-forwarded-host": "localhost",
        "x-project-path": "/attacker/chosen/path",
      },
    });

    assertEquals(await isProxyTrusted(request), false);
  });

  it("does not let a dispatch credential be replayed with different routing metadata", async () => {
    const jws = await mintFreshDispatchJws();
    const replay = new Request("https://runtime.example/_ws?x-environment=preview", {
      headers: {
        "x-veryfront-dispatch-jws": jws,
        "x-forwarded-host": "preview.veryfront.me",
        "x-project-path": "/another/project",
      },
    });

    assertEquals(await isProxyTrusted(replay), false);
  });

  it('trusts forwarded headers only when the operator setting is exactly "1"', async () => {
    Deno.env.set(ENV_KEY, "1");
    const request = new Request("https://runtime.example/", {
      headers: { "x-veryfront-dispatch-jws": "irrelevant" },
    });

    assertEquals(await isProxyTrusted(request), true);
  });

  it("fails closed for alternative truthy spellings and malformed values", async () => {
    const request = new Request("https://runtime.example/");
    for (const value of ["true", "yes", "0", "", " 1 "]) {
      Deno.env.set(ENV_KEY, value);
      assertEquals(await isProxyTrusted(request), false);
    }
  });
});
