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
 * Both privileges must be gated on a cryptographically valid signature, never
 * on mere header presence. The proxy sits at the trust boundary: any external
 * client that can reach it could otherwise set an arbitrary `x-veryfront-*-jws`
 * value and unlock the bypass and token injection for a protected environment.
 *
 * This check is deliberately a *signature + freshness* trust signal only. It
 * proves the JWS was minted by a holder of the control-plane private key and is
 * still fresh, exactly like {@link verifyDispatchJwsSignature} and
 * `isProxyTrusted`. It intentionally does not bind the signature to the request
 * body, audience, or project id: the proxy must not consume the request body
 * (it has to stream it to the renderer). That authoritative, body-bound
 * verification still runs downstream in the renderer: `verifyDispatchJws` for
 * `/channels/invoke`, `verifyControlPlaneJws` (via `verifyControlPlaneRequest`)
 * for `/api/control-plane/*` and `/internal/*`. The proxy accepts each signature
 * type only on its corresponding route family. Because downstream needs them,
 * the two signature headers are intentionally forwarded unstripped; presence is
 * no longer trusted here, so passing a forged header through is harmless (the
 * renderer rejects it).
 *
 * @module proxy/control-plane-signature
 */

import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  verifyControlPlaneJwsSignature,
  verifyDispatchJwsSignature,
} from "#veryfront/channels/control-plane.ts";

const CONTROL_PLANE_JWS_HEADER = "x-veryfront-control-plane-jws";
const DISPATCH_JWS_HEADER = "x-veryfront-dispatch-jws";

/** Header names that may carry a control-plane / dispatch signature. */
export const INTERNAL_CONTROL_PLANE_SIGNATURE_HEADERS = [
  CONTROL_PLANE_JWS_HEADER,
  DISPATCH_JWS_HEADER,
] as const;

const PUBLIC_KEY_ENV_VAR = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const MAX_SIGNATURE_AGE_SECONDS = 60;
const MAX_FORWARDED_TOKEN_LENGTH = 65_536;

/** Return whether a path belongs to a signed internal control-plane route family. */
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
  const forwardedToken = req.headers.get("x-token");
  if (!forwardedToken || forwardedToken.length > MAX_FORWARDED_TOKEN_LENGTH) return false;

  const publicKeyPem = getHostEnv(PUBLIC_KEY_ENV_VAR);
  if (!publicKeyPem) return false;

  if (url.pathname === "/channels/invoke") {
    const dispatchJws = req.headers.get(DISPATCH_JWS_HEADER);
    if (!dispatchJws) return false;
    return await verifyDispatchJwsSignature(dispatchJws, {
      publicKeyPem,
      maxAgeSeconds: MAX_SIGNATURE_AGE_SECONDS,
    });
  }

  const controlPlaneJws = req.headers.get(CONTROL_PLANE_JWS_HEADER);
  if (!controlPlaneJws) return false;
  return await verifyControlPlaneJwsSignature(controlPlaneJws, {
    publicKeyPem,
    maxAgeSeconds: MAX_SIGNATURE_AGE_SECONDS,
  });
}
