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
 * The proxy binds that trust to an exact downstream-verified method/path pair,
 * the project audience, and (once metadata is resolved) the project id. It does
 * not consume the body: authoritative body-hash verification still runs in the
 * renderer. Signature headers remain available to that downstream verifier.
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

export type InternalControlPlaneRouteKind = "dispatch" | "control-plane" | "reserved" | "public";

const CONTROL_PLANE_RUN_OPERATION_PATH =
  /^\/api\/control-plane\/runs\/[^/]+\/(?:execute|stream|resume)$/u;
const CONTROL_PLANE_RUN_PATH = /^\/api\/control-plane\/runs\/[^/]+$/u;

/**
 * Classify the internal namespace against routes whose handlers always perform
 * authoritative downstream JWS verification.
 */
export function classifyInternalControlPlaneRequest(
  method: string,
  pathname: string,
): InternalControlPlaneRouteKind {
  const normalizedMethod = method.toUpperCase();
  if (pathname === "/channels/invoke" && normalizedMethod === "POST") {
    return "dispatch";
  }
  if (
    normalizedMethod === "POST" &&
    (pathname === "/api/control-plane/agents/list" ||
      CONTROL_PLANE_RUN_OPERATION_PATH.test(pathname))
  ) {
    return "control-plane";
  }
  if (normalizedMethod === "DELETE" && CONTROL_PLANE_RUN_PATH.test(pathname)) {
    return "control-plane";
  }

  if (
    pathname === "/api/control-plane" ||
    pathname.startsWith("/api/control-plane/") ||
    pathname === "/internal/tasks" ||
    pathname.startsWith("/internal/tasks/") ||
    pathname === "/internal/workflows" ||
    pathname.startsWith("/internal/workflows/") ||
    pathname === "/channels/invoke" ||
    pathname.startsWith("/channels/invoke/")
  ) {
    return "reserved";
  }
  return "public";
}

export interface InternalControlPlaneProjectBinding {
  audience: string;
  expectedProjectId?: string;
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
  binding: InternalControlPlaneProjectBinding,
): Promise<boolean> {
  const routeKind = classifyInternalControlPlaneRequest(req.method, url.pathname);
  if (routeKind === "public" || routeKind === "reserved") return false;
  if (!binding.audience) return false;

  // The bypass only matters when there is an x-token to forward as the upstream
  // bearer; without it the request gains nothing, so reject early.
  if (!req.headers.get("x-token")) return false;

  const publicKeyPem = getHostEnv(PUBLIC_KEY_ENV_VAR);
  if (!publicKeyPem) return false;

  if (routeKind === "dispatch") {
    const dispatchJws = req.headers.get(DISPATCH_JWS_HEADER);
    if (!dispatchJws) return false;
    return await verifyDispatchJwsSignature(dispatchJws, {
      publicKeyPem,
      maxAgeSeconds: MAX_SIGNATURE_AGE_SECONDS,
      audience: binding.audience,
      expectedProjectId: binding.expectedProjectId,
    });
  }

  const controlPlaneJws = req.headers.get(CONTROL_PLANE_JWS_HEADER);
  if (!controlPlaneJws) return false;
  return await verifyControlPlaneJwsSignature(controlPlaneJws, {
    publicKeyPem,
    maxAgeSeconds: MAX_SIGNATURE_AGE_SECONDS,
    audience: binding.audience,
    expectedProjectId: binding.expectedProjectId,
  });
}
