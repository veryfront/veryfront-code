/**
 * Proxy-layer verification of internal control-plane / dispatch signatures.
 *
 * The proxy grants two privileges to "internal control-plane" requests before
 * they reach the renderer:
 *
 *   1. they bypass the protected-environment user-auth gate
 *      (`checkProtectedProxyAccess`), and
 *   2. their caller-supplied `x-token` is forwarded as the upstream API bearer
 *      token (`resolveProxyRequestToken`).
 *
 * Both privileges MUST be gated on a cryptographically valid signature, never
 * on mere header presence. The proxy sits at the trust boundary: any external
 * client that can reach it could otherwise set an arbitrary `x-veryfront-*-jws`
 * value and unlock the bypass and token injection for a protected environment.
 *
 * This check is deliberately a *signature + freshness* trust signal only — it
 * proves the JWS was minted by a holder of the control-plane private key and is
 * still fresh, exactly like {@link verifyDispatchJwsSignature} and
 * `isProxyTrusted`. It intentionally does NOT bind the signature to the request
 * body, audience, or project id: the proxy must not consume the request body
 * (it has to stream it to the renderer). That authoritative, body-bound
 * verification still runs downstream in the renderer — `verifyDispatchJws` for
 * `/channels/invoke`, `verifyControlPlaneJws` (via `verifyControlPlaneRequest`)
 * for `/api/control-plane/*` and `/internal/*`. Because downstream needs them,
 * the two signature headers are intentionally forwarded unstripped; presence is
 * no longer trusted here, so passing a forged header through is harmless (the
 * renderer rejects it).
 *
 * @module proxy/control-plane-signature
 */

import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { verifyDispatchJwsSignature } from "#veryfront/channels/control-plane.ts";

const CONTROL_PLANE_JWS_HEADER = "x-veryfront-control-plane-jws";
const DISPATCH_JWS_HEADER = "x-veryfront-dispatch-jws";

/** Header names that may carry a control-plane / dispatch signature. */
export const INTERNAL_CONTROL_PLANE_SIGNATURE_HEADERS = [
  CONTROL_PLANE_JWS_HEADER,
  DISPATCH_JWS_HEADER,
] as const;

const PUBLIC_KEY_ENV_VAR = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const EXPECTED_ISSUER = "veryfront-api";
const SIGNATURE_SKEW_SECONDS = 5;
const MAX_SIGNATURE_AGE_SECONDS = 60;

export function isInternalControlPlanePath(pathname: string): boolean {
  return pathname === "/channels/invoke" ||
    pathname.startsWith("/api/control-plane/") ||
    pathname.startsWith("/internal/tasks/") ||
    pathname.startsWith("/internal/workflows/");
}

/**
 * Returns true only for internal control-plane paths carrying a caller `x-token`
 * plus a cryptographically valid, fresh control-plane/dispatch signature.
 *
 * Fails closed: an unconfigured verification key, a missing `x-token`, a
 * non-control-plane path, or an invalid/expired signature all return false.
 */
export async function isVerifiedInternalControlPlaneRequest(
  req: Request,
  url: URL,
): Promise<boolean> {
  if (!isInternalControlPlanePath(url.pathname)) return false;

  // The bypass only matters when there is an x-token to forward as the upstream
  // bearer; without it the request gains nothing, so reject early.
  if (!req.headers.get("x-token")) return false;

  const publicKeyPem = getHostEnv(PUBLIC_KEY_ENV_VAR);
  if (!publicKeyPem) return false;

  const dispatchJws = req.headers.get(DISPATCH_JWS_HEADER);
  if (dispatchJws) {
    // `/channels/invoke` uses the dispatch header; reuse the audited helper.
    const verified = await verifyDispatchJwsSignature(dispatchJws, {
      publicKeyPem,
      maxAgeSeconds: MAX_SIGNATURE_AGE_SECONDS,
    });
    if (verified) return true;
  }

  const controlPlaneJws = req.headers.get(CONTROL_PLANE_JWS_HEADER);
  if (controlPlaneJws) {
    // `/api/control-plane/*` and `/internal/*` use the control-plane header,
    // whose claims schema differs from dispatch, so it needs a claims-agnostic
    // signature+freshness check. The channels module exposes a signature-only
    // verifier for dispatch but not (yet) for control-plane, so verify the
    // common envelope here. The body-bound check remains downstream.
    const verified = await verifyControlPlaneJwsSignature(controlPlaneJws, publicKeyPem);
    if (verified) return true;
  }

  return false;
}

interface CommonJwsClaims {
  iss?: unknown;
  iat?: unknown;
  exp?: unknown;
}

/**
 * Verify the Ed25519 signature and freshness of a control-plane JWS envelope,
 * checking only the claims shared by every control-plane/dispatch token
 * (`iss`/`iat`/`exp`). All failures — including malformed input — resolve to
 * false so this can be used as a present-but-not-proven trust signal.
 */
async function verifyControlPlaneJwsSignature(
  jws: string,
  publicKeyPem: string,
): Promise<boolean> {
  try {
    const parts = jws.split(".");
    if (parts.length !== 3) return false;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    if (!encodedHeader || !encodedPayload || !encodedSignature) return false;

    const header = parseCompactJwsPart<{ alg?: unknown }>(encodedHeader);
    if (header.alg !== "EdDSA") return false;

    const claims = parseCompactJwsPart<CommonJwsClaims>(encodedPayload);
    if (claims.iss !== EXPECTED_ISSUER) return false;
    if (typeof claims.iat !== "number" || typeof claims.exp !== "number") return false;

    const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
    const signature = base64urlDecodeToBytes(encodedSignature);
    const publicKey = await importEd25519PublicKey(publicKeyPem);
    const verified = await crypto.subtle.verify("Ed25519", publicKey, signature, signingInput);
    if (!verified) return false;

    const now = Math.floor(Date.now() / 1000);
    if (claims.exp <= now) return false;
    if (claims.iat > now + SIGNATURE_SKEW_SECONDS) return false;
    if (now - claims.iat > MAX_SIGNATURE_AGE_SECONDS) return false;

    return true;
  } catch {
    return false;
  }
}

function base64urlDecodeToBytes(input: string): ArrayBuffer {
  const normalized = input
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(input.length / 4) * 4, "=");

  return toArrayBuffer(Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0)));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function parseCompactJwsPart<T>(encodedPart: string): T {
  return JSON.parse(new TextDecoder().decode(base64urlDecodeToBytes(encodedPart))) as T;
}

function pemToDer(pem: string, label: string): ArrayBuffer {
  const body = pem
    .replace(`-----BEGIN ${label}-----`, "")
    .replace(`-----END ${label}-----`, "")
    .replace(/\s/g, "");

  return toArrayBuffer(Uint8Array.from(atob(body), (char) => char.charCodeAt(0)));
}

// Importing an SPKI key is relatively expensive; cache the last imported key so
// hot control-plane paths don't re-import on every request.
let cachedPublicKey: { pem: string; key: Promise<CryptoKey> } | undefined;

function importEd25519PublicKey(pem: string): Promise<CryptoKey> {
  if (cachedPublicKey?.pem === pem) return cachedPublicKey.key;
  const key = crypto.subtle.importKey(
    "spki",
    pemToDer(pem, "PUBLIC KEY"),
    "Ed25519",
    false,
    ["verify"],
  );
  cachedPublicKey = { pem, key };
  return key;
}
