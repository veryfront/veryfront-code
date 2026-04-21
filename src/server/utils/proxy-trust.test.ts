import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { isProxyTrusted } from "./proxy-trust.ts";

const ENV_KEY = "VERYFRONT_TRUST_FORWARDED_HEADERS";
const encoder = new TextEncoder();

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

async function mintDispatchJws(
  overrides: Partial<{
    iat: number;
    exp: number;
    issuer: string;
    audience: string;
    projectId: string;
    signingKeyPair: CryptoKeyPair;
    advertisedPublicKeyPair: CryptoKeyPair;
  }> = {},
): Promise<{ jws: string; publicKeyPem: string }> {
  const signingKeyPair = overrides.signingKeyPair ?? (await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const advertisedKeyPair = overrides.advertisedPublicKeyPair ?? signingKeyPair;

  const advertisedDer = await crypto.subtle.exportKey("spki", advertisedKeyPair.publicKey);
  const publicKeyPem = encodePem("PUBLIC KEY", advertisedDer);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", typ: "JWT" };
  const claims = {
    iss: overrides.issuer ?? "veryfront-api",
    aud: overrides.audience ?? "demo-project",
    sub: "dispatch-proxy-trust",
    project_id: overrides.projectId ?? "proj-1",
    platform: "slack",
    body_sha256: "n/a",
    iat: overrides.iat ?? now,
    exp: overrides.exp ?? now + 60,
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(claims));
  const signingInput = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign("Ed25519", signingKeyPair.privateKey, signingInput);

  return {
    publicKeyPem,
    jws: `${encodedHeader}.${encodedPayload}.${base64urlEncodeBytes(new Uint8Array(signature))}`,
  };
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

  describe("isProxyTrusted", () => {
    it("returns false when no trust signals are present", async () => {
      const req = new Request("http://example.com/");
      assertEquals(await isProxyTrusted(req), false);
    });

    it("returns true for a validly signed, fresh dispatch JWS", async () => {
      const { jws, publicKeyPem } = await mintDispatchJws();
      const req = new Request("http://example.com/", {
        headers: { "x-veryfront-dispatch-jws": jws },
      });
      assertEquals(await isProxyTrusted(req, { publicKeyPem }), true);
    });

    it("returns false when a dispatch JWS is present but no public key is configured", async () => {
      // Fails closed if the operator hasn't configured the verification key — we
      // refuse to trust an unverified header even when it looks well-formed.
      const { jws } = await mintDispatchJws();
      const req = new Request("http://example.com/", {
        headers: { "x-veryfront-dispatch-jws": jws },
      });
      assertEquals(await isProxyTrusted(req), false);
    });

    it("rejects a bogus dispatch JWS even when the header is present (VULN-SRV-3/4 regression)", async () => {
      // An attacker reaching the runtime directly could attach any value here;
      // we must not promote it to "proxy-trusted" without crypto verification.
      const { publicKeyPem } = await mintDispatchJws();
      const req = new Request("http://example.com/", {
        headers: { "x-veryfront-dispatch-jws": "eyJhbGciOi.fake.value" },
      });
      assertEquals(await isProxyTrusted(req, { publicKeyPem }), false);
    });

    it("rejects an empty dispatch JWS header value", async () => {
      const { publicKeyPem } = await mintDispatchJws();
      const req = new Request("http://example.com/", {
        headers: { "x-veryfront-dispatch-jws": "" },
      });
      assertEquals(await isProxyTrusted(req, { publicKeyPem }), false);
    });

    it("rejects a dispatch JWS signed by a different key (spoofed signature)", async () => {
      const attackerKeyPair = (await crypto.subtle.generateKey(
        "Ed25519",
        true,
        ["sign", "verify"],
      )) as CryptoKeyPair;
      const trustedKeyPair = (await crypto.subtle.generateKey(
        "Ed25519",
        true,
        ["sign", "verify"],
      )) as CryptoKeyPair;
      const { jws } = await mintDispatchJws({
        signingKeyPair: attackerKeyPair,
        advertisedPublicKeyPair: trustedKeyPair,
      });
      const publicKeyPem = encodePem(
        "PUBLIC KEY",
        await crypto.subtle.exportKey("spki", trustedKeyPair.publicKey),
      );
      const req = new Request("http://example.com/", {
        headers: { "x-veryfront-dispatch-jws": jws },
      });
      assertEquals(await isProxyTrusted(req, { publicKeyPem }), false);
    });

    it("rejects a dispatch JWS whose issuer is not veryfront-api", async () => {
      // Even with a correctly-signed token, an attacker-controlled issuer (e.g.
      // a stray key that ended up in CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY during
      // rotation) must not be accepted as a proxy-trust signal.
      const { jws, publicKeyPem } = await mintDispatchJws({ issuer: "attacker" });
      const req = new Request("http://example.com/", {
        headers: { "x-veryfront-dispatch-jws": jws },
      });
      assertEquals(await isProxyTrusted(req, { publicKeyPem }), false);
    });

    it("rejects an expired dispatch JWS", async () => {
      const now = Math.floor(Date.now() / 1000);
      const { jws, publicKeyPem } = await mintDispatchJws({
        iat: now - 120,
        exp: now - 60,
      });
      const req = new Request("http://example.com/", {
        headers: { "x-veryfront-dispatch-jws": jws },
      });
      assertEquals(await isProxyTrusted(req, { publicKeyPem }), false);
    });

    it("rejects a dispatch JWS issued too long ago", async () => {
      const now = Math.floor(Date.now() / 1000);
      const { jws, publicKeyPem } = await mintDispatchJws({
        iat: now - 3600,
        exp: now + 60,
      });
      const req = new Request("http://example.com/", {
        headers: { "x-veryfront-dispatch-jws": jws },
      });
      assertEquals(await isProxyTrusted(req, { publicKeyPem }), false);
    });

    it("is case-insensitive on the dispatch JWS header name", async () => {
      const { jws, publicKeyPem } = await mintDispatchJws();
      const req = new Request("http://example.com/", {
        headers: { "X-Veryfront-Dispatch-JWS": jws },
      });
      assertEquals(await isProxyTrusted(req, { publicKeyPem }), true);
    });

    it('returns true when VERYFRONT_TRUST_FORWARDED_HEADERS === "1"', async () => {
      Deno.env.set(ENV_KEY, "1");
      const req = new Request("http://example.com/");
      assertEquals(await isProxyTrusted(req), true);
    });

    it('returns false when env value is "true" (strict === "1" only)', async () => {
      Deno.env.set(ENV_KEY, "true");
      const req = new Request("http://example.com/");
      assertEquals(await isProxyTrusted(req), false);
    });

    it('returns false when env value is "0"', async () => {
      Deno.env.set(ENV_KEY, "0");
      const req = new Request("http://example.com/");
      assertEquals(await isProxyTrusted(req), false);
    });

    it("returns false when env value is an empty string", async () => {
      Deno.env.set(ENV_KEY, "");
      const req = new Request("http://example.com/");
      assertEquals(await isProxyTrusted(req), false);
    });

    it('returns false when env value has whitespace around "1" (strict match)', async () => {
      // Fail-closed: misconfiguration should not accidentally enable trust.
      Deno.env.set(ENV_KEY, " 1 ");
      const req = new Request("http://example.com/");
      assertEquals(await isProxyTrusted(req), false);
    });

    it("returns false when env var is unset and no JWS is presented", async () => {
      // beforeEach already deleted it; this documents the default posture.
      const req = new Request("http://example.com/");
      assertEquals(await isProxyTrusted(req), false);
    });

    it("env opt-in short-circuits the JWS check entirely", async () => {
      // Operator opt-in wins even when a bogus header is present — useful for
      // environments where the operator has another upstream trust boundary.
      Deno.env.set(ENV_KEY, "1");
      const req = new Request("http://example.com/", {
        headers: { "x-veryfront-dispatch-jws": "anything" },
      });
      assertEquals(await isProxyTrusted(req), true);
    });
  });
});
