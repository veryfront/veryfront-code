import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import { isAuthenticInternalControlPlaneCandidate } from "./control-plane-signature.ts";

/**
 * Cross-repo contract: control-plane-signature.test.ts mints its own compliant
 * JWS, so it never exercises what veryfront-api actually sends. This mints the
 * payload exactly as veryfront-api's createControlPlaneRequestSignature does.
 */

const PUBLIC_KEY_ENV = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const RUN_STREAM_URL =
  "http://outlook-agent-hvjoe9.preview.veryfront.org/api/control-plane/runs/r_1/stream";
const encoder = new TextEncoder();

function base64url(data: string): string {
  return btoa(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlBytes(bytes: Uint8Array): string {
  return base64url(String.fromCharCode(...bytes));
}

async function sha256Base64url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64urlBytes(new Uint8Array(digest));
}

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

/** Mint a control-plane JWS with exactly the claim set veryfront-api signs. */
async function mintApiStyleJws(
  body: string,
  claimOverrides: Record<string, unknown> = {},
): Promise<{ jws: string; publicKeyPem: string }> {
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKeyPem = encodePem(
    "PUBLIC KEY",
    await crypto.subtle.exportKey("spki", keyPair.publicKey),
  );

  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: "veryfront-api",
    aud: "outlook-agent-hvjoe9",
    sub: "r_1",
    surface: "studio",
    project_id: "979f3e04-e951-4807-8aa8-98530d9b8ba1",
    request_hash: await sha256Base64url(body),
    request_method: "POST",
    request_path: "/api/control-plane/runs/r_1/stream",
    iat: now,
    exp: now + 300,
    ...claimOverrides,
  };
  for (const [key, value] of Object.entries(claimOverrides)) {
    if (value === undefined) delete payload[key];
  }

  const encodedHeader = base64url(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    "Ed25519",
    keyPair.privateKey,
    encoder.encode(`${encodedHeader}.${encodedPayload}`),
  );

  return {
    publicKeyPem,
    jws: `${encodedHeader}.${encodedPayload}.${base64urlBytes(new Uint8Array(signature))}`,
  };
}

async function verifyApiStyleRequest(
  claimOverrides: Record<string, unknown> = {},
): Promise<boolean> {
  const body = JSON.stringify({ messages: [{ role: "user", content: "hi" }] });
  const { jws, publicKeyPem } = await mintApiStyleJws(body, claimOverrides);
  Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);

  const req = new Request(RUN_STREAM_URL, {
    method: "POST",
    headers: {
      "x-token": "user-token",
      "x-veryfront-control-plane-jws": jws,
    },
    body,
  });

  return await isAuthenticInternalControlPlaneCandidate(req, new URL(RUN_STREAM_URL));
}

describe("control-plane signature: veryfront-api contract", () => {
  afterEach(() => {
    Deno.env.delete(PUBLIC_KEY_ENV);
  });

  it("accepts the JWS veryfront-api actually mints", async () => {
    assertEquals(await verifyApiStyleRequest(), true);
  });

  // 0.1.1189 (#3251) added these claims; veryfront-api kept minting the old set
  // and every run against a protected environment was 302'd to sign-in.
  it("rejects a JWS missing request_method", async () => {
    assertEquals(await verifyApiStyleRequest({ request_method: undefined }), false);
  });

  it("rejects a JWS missing request_path", async () => {
    assertEquals(await verifyApiStyleRequest({ request_path: undefined }), false);
  });

  it("rejects a JWS whose request_method does not match the request", async () => {
    assertEquals(await verifyApiStyleRequest({ request_method: "DELETE" }), false);
  });

  it("rejects a JWS whose request_path does not match the request", async () => {
    assertEquals(
      await verifyApiStyleRequest({ request_path: "/api/control-plane/runs/r_1" }),
      false,
    );
  });
});

describe("control-plane signature: rejection reasons", () => {
  afterEach(() => {
    Deno.env.delete(PUBLIC_KEY_ENV);
  });

  async function reasonFor(
    build: (jws: string) => { headers: Record<string, string>; publicKeyPem?: string },
  ): Promise<string | undefined> {
    const body = JSON.stringify({ messages: [] });
    const { jws, publicKeyPem } = await mintApiStyleJws(body);
    const built = build(jws);
    Deno.env.delete(PUBLIC_KEY_ENV);
    if (built.publicKeyPem ?? publicKeyPem) {
      Deno.env.set(PUBLIC_KEY_ENV, built.publicKeyPem ?? publicKeyPem);
    }

    const reasons: string[] = [];
    const req = new Request(RUN_STREAM_URL, { method: "POST", headers: built.headers, body });
    await isAuthenticInternalControlPlaneCandidate(req, new URL(RUN_STREAM_URL), {
      warn: (_msg, extra) => {
        if (typeof extra?.reason === "string") reasons.push(extra.reason);
      },
    });
    return reasons[0];
  }

  it("reports a missing x-token", async () => {
    assertEquals(
      await reasonFor((jws) => ({ headers: { "x-veryfront-control-plane-jws": jws } })),
      "missing_x_token",
    );
  });

  it("reports an unconfigured verification key", async () => {
    assertEquals(
      await reasonFor((jws) => ({
        headers: { "x-token": "t", "x-veryfront-control-plane-jws": jws },
        publicKeyPem: "",
      })),
      "verification_key_not_configured",
    );
  });

  it("reports a missing signature header", async () => {
    assertEquals(
      await reasonFor(() => ({ headers: { "x-token": "t" } })),
      "missing_signature_header",
    );
  });

  it("reports a rejected signature", async () => {
    assertEquals(
      await reasonFor((jws) => ({
        headers: { "x-token": "t", "x-veryfront-control-plane-jws": `${jws}tampered` },
      })),
      "signature_rejected",
    );
  });

  it("stays silent for ordinary non-internal routes", async () => {
    const reasons: string[] = [];
    const pageUrl = "http://slug.preview.veryfront.org/";
    await isAuthenticInternalControlPlaneCandidate(
      new Request(pageUrl, { method: "GET" }),
      new URL(pageUrl),
      { warn: (_msg, extra) => reasons.push(String(extra?.reason)) },
    );
    assertEquals(reasons.length, 0);
  });
});
