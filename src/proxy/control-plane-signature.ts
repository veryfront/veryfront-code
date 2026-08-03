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
  verifyControlPlaneJwsRequestSignature,
  verifyControlPlaneJwsSignature,
  verifyDispatchJwsSignature,
} from "#veryfront/channels/control-plane.ts";
import { isRequestBodyTooLargeError, readBodyWithLimit } from "#veryfront/security/index.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";
import { isCanonicalOpaqueProjectIdentifier } from "#veryfront/utils/project-identity.ts";

const CONTROL_PLANE_JWS_HEADER = "x-veryfront-control-plane-jws";
const DISPATCH_JWS_HEADER = "x-veryfront-dispatch-jws";

/** Header names that may carry a control-plane / dispatch signature. */
export const INTERNAL_CONTROL_PLANE_SIGNATURE_HEADERS = [
  CONTROL_PLANE_JWS_HEADER,
  DISPATCH_JWS_HEADER,
] as const;

const PUBLIC_KEY_ENV_VAR = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const MAX_SIGNATURE_AGE_SECONDS = 60;
const MAX_BRANCH_NAME_CODE_UNITS = 255;

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

export interface VerifiedControlPlaneBranchBinding {
  branchId?: string;
  branchName?: string;
  defaultBranchName?: string;
}

export class ControlPlaneBranchBindingError extends Error {
  constructor(
    readonly status: 400 | 401 | 413,
    message: string,
  ) {
    super(message);
    this.name = "ControlPlaneBranchBindingError";
  }
}

function requireBranchName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_BRANCH_NAME_CODE_UNITS ||
    value !== value.trim()
  ) {
    throw new ControlPlaneBranchBindingError(400, "Invalid control-plane branch target");
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      throw new ControlPlaneBranchBindingError(400, "Invalid control-plane branch target");
    }
  }
  return value;
}

function parseVerifiedBranchBinding(rawBody: string): VerifiedControlPlaneBranchBinding {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new ControlPlaneBranchBindingError(400, "Invalid control-plane request body");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ControlPlaneBranchBindingError(400, "Invalid control-plane request body");
  }

  const request = value as Record<string, unknown>;
  const run = request.run;
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new ControlPlaneBranchBindingError(400, "Invalid control-plane request body");
  }
  const project = (run as Record<string, unknown>).project;
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new ControlPlaneBranchBindingError(400, "Invalid control-plane runtime target");
  }
  const target = project as Record<string, unknown>;
  const source = request.agentSource;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new ControlPlaneBranchBindingError(400, "Invalid control-plane source target");
  }
  const sourceRecord = source as Record<string, unknown>;

  switch (target.runtimeTargetKind ?? "main_branch") {
    case "preview_branch": {
      if (
        sourceRecord.type !== "branch" ||
        !isCanonicalOpaqueProjectIdentifier(target.runtimeTargetBranchId) ||
        target.runtimeTargetEnvironmentId !== null &&
          target.runtimeTargetEnvironmentId !== undefined
      ) {
        throw new ControlPlaneBranchBindingError(400, "Invalid control-plane preview target");
      }
      return Object.freeze({
        branchId: target.runtimeTargetBranchId,
        branchName: requireBranchName(sourceRecord.branch),
      });
    }
    case "main_branch":
      if (
        target.runtimeTargetBranchId !== null && target.runtimeTargetBranchId !== undefined ||
        target.runtimeTargetEnvironmentId !== null &&
          target.runtimeTargetEnvironmentId !== undefined
      ) {
        throw new ControlPlaneBranchBindingError(
          400,
          "Invalid control-plane default branch target",
        );
      }
      if (sourceRecord.type === "branch") {
        return Object.freeze({ defaultBranchName: requireBranchName(sourceRecord.branch) });
      }
      if (sourceRecord.type === "release") return Object.freeze({});
      throw new ControlPlaneBranchBindingError(400, "Invalid control-plane default branch source");
    case "environment":
      if (
        sourceRecord.type !== "environment" ||
        !isCanonicalOpaqueProjectIdentifier(target.runtimeTargetEnvironmentId) ||
        target.runtimeTargetBranchId !== null && target.runtimeTargetBranchId !== undefined
      ) {
        throw new ControlPlaneBranchBindingError(400, "Invalid control-plane environment source");
      }
      return Object.freeze({});
    default:
      throw new ControlPlaneBranchBindingError(400, "Invalid control-plane runtime target");
  }
}

/**
 * Resolve branch identity only from a body-bound control-plane signature.
 * Caller-provided branch headers are never consulted.
 */
export async function resolveVerifiedControlPlaneBranchBinding(
  req: Request,
  url: URL,
  binding: InternalControlPlaneProjectBinding,
): Promise<VerifiedControlPlaneBranchBinding | undefined> {
  if (
    req.method.toUpperCase() !== "POST" ||
    !/^\/api\/control-plane\/runs\/[^/]+\/stream$/u.test(url.pathname)
  ) {
    return undefined;
  }

  const jws = req.headers.get(CONTROL_PLANE_JWS_HEADER);
  const publicKeyPem = getHostEnv(PUBLIC_KEY_ENV_VAR);
  if (!jws || !publicKeyPem) {
    throw new ControlPlaneBranchBindingError(401, "Invalid control-plane signature");
  }

  let rawBody: string;
  try {
    rawBody = await readBodyWithLimit(req.clone(), DEFAULT_MAX_BODY_SIZE_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      throw new ControlPlaneBranchBindingError(413, "Control-plane request body is too large");
    }
    throw error;
  }

  const verified = await verifyControlPlaneJwsRequestSignature(jws, rawBody, {
    publicKeyPem,
    maxAgeSeconds: MAX_SIGNATURE_AGE_SECONDS,
    audience: binding.audience,
    expectedProjectId: binding.expectedProjectId,
    requestMethod: req.method,
    requestPath: url.pathname,
  });
  if (!verified) {
    throw new ControlPlaneBranchBindingError(401, "Invalid control-plane signature");
  }
  return parseVerifiedBranchBinding(rawBody);
}

async function verifyInternalControlPlaneSignature(
  req: Request,
  url: URL,
  binding?: InternalControlPlaneProjectBinding,
): Promise<boolean> {
  const routeKind = classifyInternalControlPlaneRequest(req.method, url.pathname);
  if (routeKind === "public" || routeKind === "reserved") return false;

  // The candidate only matters when there is an x-token to use for metadata
  // lookup or forward after the resolved project binding succeeds.
  if (!req.headers.get("x-token")) return false;

  const publicKeyPem = getHostEnv(PUBLIC_KEY_ENV_VAR);
  if (!publicKeyPem) return false;

  if (routeKind === "dispatch") {
    const dispatchJws = req.headers.get(DISPATCH_JWS_HEADER);
    if (!dispatchJws) return false;
    return await verifyDispatchJwsSignature(dispatchJws, {
      publicKeyPem,
      maxAgeSeconds: MAX_SIGNATURE_AGE_SECONDS,
      ...(binding
        ? {
          audience: binding.audience,
          expectedProjectId: binding.expectedProjectId,
        }
        : {}),
    });
  }

  const controlPlaneJws = req.headers.get(CONTROL_PLANE_JWS_HEADER);
  if (!controlPlaneJws) return false;
  return await verifyControlPlaneJwsSignature(controlPlaneJws, {
    publicKeyPem,
    maxAgeSeconds: MAX_SIGNATURE_AGE_SECONDS,
    requestMethod: req.method,
    requestPath: url.pathname,
    ...(binding
      ? {
        audience: binding.audience,
        expectedProjectId: binding.expectedProjectId,
      }
      : {}),
  });
}

/**
 * Authenticate a signed internal request before a custom domain has resolved
 * to its project audience.
 *
 * This result may authorize only the project-metadata lookup needed to resolve
 * that audience. The caller must re-verify with
 * {@link isVerifiedInternalControlPlaneRequest} and the resolved project slug
 * and id before bypassing user authentication or forwarding the inbound token.
 */
export async function isAuthenticInternalControlPlaneCandidate(
  req: Request,
  url: URL,
): Promise<boolean> {
  return await verifyInternalControlPlaneSignature(req, url);
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
  if (!binding.audience) return false;
  return await verifyInternalControlPlaneSignature(req, url, binding);
}
