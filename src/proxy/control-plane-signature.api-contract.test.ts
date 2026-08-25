import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  ControlPlaneBranchBindingError,
  isAuthenticInternalControlPlaneCandidate,
  isVerifiedInternalControlPlaneRequest,
  resolveVerifiedControlPlaneBranchBinding,
} from "./control-plane-signature.ts";

/**
 * Cross-repo contract: control-plane-signature.test.ts mints its own compliant
 * JWS, so it never exercises what veryfront-api actually sends. This mints the
 * payload exactly as veryfront-api's createControlPlaneRequestSignature does.
 */

const PUBLIC_KEY_ENV = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const RUN_STREAM_URL = "http://protected.preview.veryfront.com/api/control-plane/runs/r_1/stream";
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
    aud: "protected",
    sub: "r_1",
    surface: "studio",
    project_id: "proj-1",
    request_hash: await sha256Base64url(body),
    request_method: "POST",
    request_path: "/api/control-plane/runs/r_1/stream",
    iat: now,
    exp: now + 300,
    ...claimOverrides,
  };
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

/**
 * Verify through the BOUND entry point. The unbound candidate check leaves aud,
 * project_id and request_hash unverified, so asserting through it would let
 * those three claims drift silently.
 *
 * Two claims stay deliberately unbound here. `sub` is never compared on this
 * path — the run id is already pinned through request_path — and `surface` is
 * only checked for membership of CONTROL_PLANE_SURFACES, because the proxy has
 * no business asserting which surface a caller speaks for.
 */
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

  return await isVerifiedInternalControlPlaneRequest(req, new URL(RUN_STREAM_URL), {
    audience: "protected",
    expectedProjectId: "proj-1",
  });
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

  // Verified through the bound entry point, so a drifted audience or project id
  // is caught. The unbound candidate check leaves both unverified.
  it("rejects a JWS whose aud is not the bound project", async () => {
    assertEquals(await verifyApiStyleRequest({ aud: "another-project" }), false);
  });

  it("rejects a JWS whose project_id is not the bound project", async () => {
    assertEquals(await verifyApiStyleRequest({ project_id: "another-project-id" }), false);
  });

  it("rejects a JWS whose request_path does not match the request", async () => {
    assertEquals(
      await verifyApiStyleRequest({ request_path: "/api/control-plane/runs/r_1" }),
      false,
    );
  });
});

describe("control-plane signature: body binding", () => {
  afterEach(() => {
    Deno.env.delete(PUBLIC_KEY_ENV);
  });

  async function resolveBinding(signedBody: string, sentBody: string) {
    const { jws, publicKeyPem } = await mintApiStyleJws(signedBody);
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const req = new Request(RUN_STREAM_URL, {
      method: "POST",
      headers: { "x-token": "t", "x-veryfront-control-plane-jws": jws },
      body: sentBody,
    });
    return await resolveVerifiedControlPlaneBranchBinding(req, new URL(RUN_STREAM_URL), {
      audience: "protected",
      expectedProjectId: "proj-1",
    });
  }

  const RUN_BODY = JSON.stringify({
    run: { project: {} },
    agentSource: { type: "release" },
  });

  it("accepts a body matching the signed request_hash", async () => {
    assertEquals(await resolveBinding(RUN_BODY, RUN_BODY), {});
  });

  it("rejects a body that does not match the signed request_hash", async () => {
    const error = await assertRejects(
      () =>
        resolveBinding(
          RUN_BODY,
          JSON.stringify({
            run: { project: {} },
            agentSource: { type: "release" },
            tampered: true,
          }),
        ),
      ControlPlaneBranchBindingError,
      "Invalid control-plane signature",
    );
    assertInstanceOf(
      error,
      ControlPlaneBranchBindingError,
      "the rejection must be the typed control-plane binding error, not a bare Error",
    );
    assertEquals(
      error.status,
      401,
      "a body-hash mismatch must be the typed 401 the proxy handler can map to a sanitized response",
    );
  });
});

describe("control-plane signature: rejection reasons", () => {
  afterEach(() => {
    Deno.env.delete(PUBLIC_KEY_ENV);
  });

  async function reasonsFor(
    build: (jws: string) => { headers: Record<string, string>; publicKeyPem?: string },
    url = RUN_STREAM_URL,
  ): Promise<{ reasons: string[]; pathnames: string[] }> {
    const body = JSON.stringify({ messages: [] });
    const { jws, publicKeyPem } = await mintApiStyleJws(body);
    const built = build(jws);
    Deno.env.delete(PUBLIC_KEY_ENV);
    const key = built.publicKeyPem ?? publicKeyPem;
    if (key !== "") Deno.env.set(PUBLIC_KEY_ENV, key);

    const reasons: string[] = [];
    const pathnames: string[] = [];
    const req = new Request(url, { method: "POST", headers: built.headers, body });
    await isAuthenticInternalControlPlaneCandidate(req, new URL(url), {
      warn: (_msg, extra) => {
        if (typeof extra?.reason === "string") reasons.push(extra.reason);
        if (typeof extra?.pathname === "string") pathnames.push(extra.pathname);
      },
    });
    return { reasons, pathnames };
  }

  /** Exactly one warn, carrying the expected reason. */
  async function reasonFor(
    build: (jws: string) => { headers: Record<string, string>; publicKeyPem?: string },
  ): Promise<string | undefined> {
    const { reasons } = await reasonsFor(build);
    assertEquals(reasons.length, 1);
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

  it("reports a missing control-plane header when a dispatch signature was presented", async () => {
    assertEquals(
      await reasonFor((jws) => ({ headers: { "x-token": "t", "x-veryfront-dispatch-jws": jws } })),
      "missing_signature_header",
    );
  });

  // An unauthenticated client picks the runId segment, so logging one line per
  // request would be a remote write into log ingest.
  it("stays silent for a caller that presented no signature header", async () => {
    const { reasons } = await reasonsFor(() => ({ headers: { "x-token": "t" } }));
    assertEquals(reasons, []);
  });

  it("stays silent for an unauthenticated request with a huge path", async () => {
    const huge = `http://protected.preview.veryfront.com/api/control-plane/runs/${
      "A".repeat(8000)
    }/stream`;
    const { reasons } = await reasonsFor(() => ({ headers: {} }), huge);
    assertEquals(reasons, []);
  });

  it("bounds the logged pathname", async () => {
    const huge = `http://protected.preview.veryfront.com/api/control-plane/runs/${
      "A".repeat(8000)
    }/stream`;
    const { pathnames } = await reasonsFor(
      (jws) => ({ headers: { "x-veryfront-control-plane-jws": jws } }),
      huge,
    );
    assertEquals(pathnames.length, 1);
    assertEquals(pathnames[0]?.length, 256);
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
    const pageUrl = "http://protected.preview.veryfront.com/";
    await isAuthenticInternalControlPlaneCandidate(
      new Request(pageUrl, { method: "GET" }),
      new URL(pageUrl),
      { warn: (_msg, extra) => reasons.push(String(extra?.reason)) },
    );
    assertEquals(reasons.length, 0);
  });
});
