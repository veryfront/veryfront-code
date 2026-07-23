import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { isVerifiedInternalControlPlaneRequest } from "./control-plane-signature.ts";

const PUBLIC_KEY_ENV = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const CONTROL_PLANE_PATH =
  "http://protected.preview.veryfront.com/api/control-plane/runs/r_1/stream";
const encoder = new TextEncoder();

function base64url(data: string): string {
  return btoa(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlBytes(bytes: Uint8Array): string {
  return base64url(String.fromCharCode(...bytes));
}

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

type JwsKind = "dispatch" | "control-plane";

async function mintJws(
  kind: JwsKind,
  overrides: Partial<{
    iss: string;
    iat: number;
    exp: number;
    alg: string;
    signingKeyPair: CryptoKeyPair;
    advertisedKeyPair: CryptoKeyPair;
  }> = {},
): Promise<{ jws: string; publicKeyPem: string }> {
  const signingKeyPair = overrides.signingKeyPair ??
    (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair);
  const advertisedKeyPair = overrides.advertisedKeyPair ?? signingKeyPair;

  const der = await crypto.subtle.exportKey("spki", advertisedKeyPair.publicKey);
  const publicKeyPem = encodePem("PUBLIC KEY", der);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: overrides.alg ?? "EdDSA", typ: "JWT" };
  const base = {
    iss: overrides.iss ?? "veryfront-api",
    aud: "protected",
    sub: "control-plane",
    project_id: "proj-1",
    iat: overrides.iat ?? now,
    exp: overrides.exp ?? now + 60,
  };
  const claims = kind === "dispatch"
    ? { ...base, platform: "slack", body_sha256: "a".repeat(43) }
    : { ...base, surface: "channels", request_hash: "a".repeat(43) };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(claims));
  const signingInput = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign("Ed25519", signingKeyPair.privateKey, signingInput);

  return {
    publicKeyPem,
    jws: `${encodedHeader}.${encodedPayload}.${base64urlBytes(new Uint8Array(signature))}`,
  };
}

function requestWith(headers: Record<string, string>, url = CONTROL_PLANE_PATH): {
  req: Request;
  url: URL;
} {
  return { req: new Request(url, { headers }), url: new URL(url) };
}

describe("proxy/control-plane-signature", () => {
  let previousKey: string | undefined;

  beforeEach(() => {
    previousKey = Deno.env.get(PUBLIC_KEY_ENV);
    Deno.env.delete(PUBLIC_KEY_ENV);
  });

  afterEach(() => {
    if (previousKey === undefined) Deno.env.delete(PUBLIC_KEY_ENV);
    else Deno.env.set(PUBLIC_KEY_ENV, previousKey);
  });

  it("returns false for non-control-plane paths", async () => {
    const { jws, publicKeyPem } = await mintJws("dispatch");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith(
      { "x-token": "t", "x-veryfront-dispatch-jws": jws },
      "http://protected.preview.veryfront.com/some/page",
    );
    assertEquals(await isVerifiedInternalControlPlaneRequest(req, url), false);
  });

  it("returns false when x-token is missing", async () => {
    const { jws, publicKeyPem } = await mintJws("control-plane");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({ "x-veryfront-control-plane-jws": jws });
    assertEquals(await isVerifiedInternalControlPlaneRequest(req, url), false);
  });

  it("returns false when x-token exceeds the proxy forwarding limit", async () => {
    const { jws, publicKeyPem } = await mintJws("control-plane");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({
      "x-token": "x".repeat(65_537),
      "x-veryfront-control-plane-jws": jws,
    });
    assertEquals(await isVerifiedInternalControlPlaneRequest(req, url), false);
  });

  it("returns false when the verification key is not configured", async () => {
    const { jws } = await mintJws("control-plane");
    const { req, url } = requestWith({ "x-token": "t", "x-veryfront-control-plane-jws": jws });
    assertEquals(await isVerifiedInternalControlPlaneRequest(req, url), false);
  });

  it("returns false when only a presence-only (non-JWS) header is set", async () => {
    const { publicKeyPem } = await mintJws("control-plane");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({
      "x-token": "t",
      "x-veryfront-control-plane-jws": "signed-request",
    });
    assertEquals(await isVerifiedInternalControlPlaneRequest(req, url), false);
  });

  it("returns true for a valid, fresh dispatch JWS on /channels/invoke", async () => {
    const { jws, publicKeyPem } = await mintJws("dispatch");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith(
      { "x-token": "t", "x-veryfront-dispatch-jws": jws },
      "http://protected.preview.veryfront.com/channels/invoke",
    );
    assertEquals(await isVerifiedInternalControlPlaneRequest(req, url), true);
  });

  it("returns true for a valid, fresh control-plane JWS", async () => {
    const { jws, publicKeyPem } = await mintJws("control-plane");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({ "x-token": "t", "x-veryfront-control-plane-jws": jws });
    assertEquals(await isVerifiedInternalControlPlaneRequest(req, url), true);
  });

  it("does not accept a valid signature from the wrong control-plane protocol", async () => {
    const dispatch = await mintJws("dispatch");
    Deno.env.set(PUBLIC_KEY_ENV, dispatch.publicKeyPem);
    const controlPlaneRequest = requestWith({
      "x-token": "t",
      "x-veryfront-dispatch-jws": dispatch.jws,
    });
    assertEquals(
      await isVerifiedInternalControlPlaneRequest(
        controlPlaneRequest.req,
        controlPlaneRequest.url,
      ),
      false,
    );

    const controlPlane = await mintJws("control-plane");
    Deno.env.set(PUBLIC_KEY_ENV, controlPlane.publicKeyPem);
    const channelRequest = requestWith(
      { "x-token": "t", "x-veryfront-control-plane-jws": controlPlane.jws },
      "http://protected.preview.veryfront.com/channels/invoke",
    );
    assertEquals(
      await isVerifiedInternalControlPlaneRequest(channelRequest.req, channelRequest.url),
      false,
    );
  });

  it("returns false for a signature minted by a different key", async () => {
    const signingKeyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]) as CryptoKeyPair;
    const advertisedKeyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]) as CryptoKeyPair;
    const { jws, publicKeyPem } = await mintJws("control-plane", {
      signingKeyPair,
      advertisedKeyPair,
    });
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({ "x-token": "t", "x-veryfront-control-plane-jws": jws });
    assertEquals(await isVerifiedInternalControlPlaneRequest(req, url), false);
  });

  it("returns false for an unexpected issuer", async () => {
    const { jws, publicKeyPem } = await mintJws("control-plane", { iss: "evil" });
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({ "x-token": "t", "x-veryfront-control-plane-jws": jws });
    assertEquals(await isVerifiedInternalControlPlaneRequest(req, url), false);
  });

  it("returns false for an expired signature", async () => {
    const now = Math.floor(Date.now() / 1000);
    const { jws, publicKeyPem } = await mintJws("control-plane", {
      iat: now - 120,
      exp: now - 60,
    });
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({ "x-token": "t", "x-veryfront-control-plane-jws": jws });
    assertEquals(await isVerifiedInternalControlPlaneRequest(req, url), false);
  });

  it("returns false for a stale (too old) but unexpired signature", async () => {
    const now = Math.floor(Date.now() / 1000);
    const { jws, publicKeyPem } = await mintJws("control-plane", {
      iat: now - 300,
      exp: now + 300,
    });
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({ "x-token": "t", "x-veryfront-control-plane-jws": jws });
    assertEquals(await isVerifiedInternalControlPlaneRequest(req, url), false);
  });

  it("returns false for a non-EdDSA algorithm header", async () => {
    const { jws, publicKeyPem } = await mintJws("control-plane", { alg: "HS256" });
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({ "x-token": "t", "x-veryfront-control-plane-jws": jws });
    assertEquals(await isVerifiedInternalControlPlaneRequest(req, url), false);
  });

  it("returns false for a malformed JWS", async () => {
    const { publicKeyPem } = await mintJws("control-plane");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({
      "x-token": "t",
      "x-veryfront-control-plane-jws": "not.a.jws",
    });
    assertEquals(await isVerifiedInternalControlPlaneRequest(req, url), false);
  });
});
