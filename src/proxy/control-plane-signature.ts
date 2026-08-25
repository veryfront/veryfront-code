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
 * Rejections are logged with a reason so a turned-away internal caller can be
 * diagnosed from one line. The reason is never returned to the client, and
 * anonymous traffic that presented no signature header is not logged at all.
 *
 * @module proxy/control-plane-signature
 */

import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  CHANNEL_INVOKE_PATH,
  isChannelDispatchRoute,
  isControlPlaneSurfaceRoute,
  verifyControlPlaneJwsRequestSignature,
  verifyControlPlaneJwsSignature,
  verifyDispatchJwsSignature,
} from "#veryfront/channels/control-plane.ts";
import {
  isRequestBodyTooLargeError,
  readBodyWithLimit,
} from "#veryfront/security/input-validation/limits.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";
import { isWellFormedString } from "#veryfront/utils/is-well-formed-string.ts";
import { isCanonicalOpaqueProjectIdentifier } from "#veryfront/utils/project-identity.ts";

export interface InternalControlPlaneSignatureLogger {
  warn: (msg: string, extra?: Record<string, unknown>) => void;
}

const CONTROL_PLANE_JWS_HEADER = "x-veryfront-control-plane-jws";
const DISPATCH_JWS_HEADER = "x-veryfront-dispatch-jws";

/** Header names that may carry a control-plane / dispatch signature. */
export const INTERNAL_CONTROL_PLANE_SIGNATURE_HEADERS = [
  CONTROL_PLANE_JWS_HEADER,
  DISPATCH_JWS_HEADER,
] as const;

const MAX_LOGGED_PATHNAME_CODE_UNITS = 256;
const PUBLIC_KEY_ENV_VAR = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const MAX_SIGNATURE_AGE_SECONDS = 60;
const MAX_BRANCH_NAME_CODE_UNITS = 255;

export type InternalControlPlaneRouteKind = "dispatch" | "control-plane" | "reserved" | "public";

/**
 * Classify the internal namespace against routes whose handlers always perform
 * authoritative downstream JWS verification.
 *
 * `control-plane` and `reserved` differ in exactly the way that matters to a
 * caller deciding what to trust: `control-plane` names a route the runtime
 * serves through a verifying handler, `reserved` names the rest of the
 * namespace, which a project can occupy with its own routes.
 */
export function classifyInternalControlPlaneRequest(
  method: string,
  pathname: string,
): InternalControlPlaneRouteKind {
  const normalizedMethod = method.toUpperCase();
  if (isChannelDispatchRoute(normalizedMethod, pathname)) {
    return "dispatch";
  }
  if (isControlPlaneSurfaceRoute(normalizedMethod, pathname)) {
    return "control-plane";
  }

  if (
    pathname === "/api/control-plane" ||
    pathname.startsWith("/api/control-plane/") ||
    pathname === "/internal/tasks" ||
    pathname.startsWith("/internal/tasks/") ||
    pathname === "/internal/workflows" ||
    pathname.startsWith("/internal/workflows/") ||
    pathname === CHANNEL_INVOKE_PATH ||
    pathname.startsWith(`${CHANNEL_INVOKE_PATH}/`)
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
    !isWellFormedString(value) ||
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
    // The route gate above admits only POST (case-insensitively); verify the
    // canonical method the control plane signs rather than the raw casing.
    requestMethod: "POST",
    requestPath: url.pathname,
  });
  if (!verified) {
    throw new ControlPlaneBranchBindingError(401, "Invalid control-plane signature");
  }
  return parseVerifiedBranchBinding(rawBody);
}

/**
 * Why a signed-internal check did not admit the request.
 *
 * "reserved" routes are internal but never admissible, so they share the silent
 * `route_not_admissible` reason with ordinary public traffic.
 */
export type InternalControlPlaneRejection =
  | "route_not_admissible"
  | "missing_x_token"
  | "verification_key_not_configured"
  | "missing_signature_header"
  | "signature_rejected";

async function checkInternalControlPlaneSignature(
  req: Request,
  url: URL,
  binding?: InternalControlPlaneProjectBinding,
): Promise<InternalControlPlaneRejection | null> {
  const routeKind = classifyInternalControlPlaneRequest(req.method, url.pathname);
  if (routeKind === "public" || routeKind === "reserved") return "route_not_admissible";

  // The candidate only matters when there is an x-token to use for metadata
  // lookup or forward after the resolved project binding succeeds.
  if (!req.headers.get("x-token")) return "missing_x_token";

  const publicKeyPem = getHostEnv(PUBLIC_KEY_ENV_VAR);
  if (!publicKeyPem) return "verification_key_not_configured";

  if (routeKind === "dispatch") {
    const dispatchJws = req.headers.get(DISPATCH_JWS_HEADER);
    if (!dispatchJws) return "missing_signature_header";
    const verified = await verifyDispatchJwsSignature(dispatchJws, {
      publicKeyPem,
      maxAgeSeconds: MAX_SIGNATURE_AGE_SECONDS,
      ...(binding
        ? {
          audience: binding.audience,
          expectedProjectId: binding.expectedProjectId,
        }
        : {}),
    });
    return verified ? null : "signature_rejected";
  }

  const controlPlaneJws = req.headers.get(CONTROL_PLANE_JWS_HEADER);
  if (!controlPlaneJws) return "missing_signature_header";
  const verified = await verifyControlPlaneJwsSignature(controlPlaneJws, {
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
  return verified ? null : "signature_rejected";
}

async function verifyInternalControlPlaneSignature(
  req: Request,
  url: URL,
  binding?: InternalControlPlaneProjectBinding,
  logger?: InternalControlPlaneSignatureLogger,
): Promise<boolean> {
  const rejection = await checkInternalControlPlaneSignature(req, url, binding);
  if (rejection === null) return true;

  if (shouldLogRejection(req, rejection)) {
    logger?.warn("Internal control-plane signature not accepted", {
      reason: rejection,
      method: req.method,
      // Two admissible route patterns carry an unbounded runId segment, and any
      // unauthenticated client can choose it. Logging it whole is a remote
      // write into log ingest, so bound it.
      pathname: url.pathname.slice(0, MAX_LOGGED_PATHNAME_CODE_UNITS),
      ...(binding?.audience ? { audience: binding.audience } : {}),
    });
  }

  return false;
}

/**
 * Log only rejections that describe a caller which tried to authenticate.
 *
 * A request carrying no signature header at all is anonymous internet traffic
 * that chose its own path; one line per request is amplification, and it buries
 * the rejections that describe a real internal caller. Every reason still logs
 * once a signature header is present.
 */
function shouldLogRejection(req: Request, rejection: InternalControlPlaneRejection): boolean {
  if (rejection === "route_not_admissible") return false;
  if (rejection === "verification_key_not_configured") return true;
  return INTERNAL_CONTROL_PLANE_SIGNATURE_HEADERS.some((header) => req.headers.has(header));
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
  logger?: InternalControlPlaneSignatureLogger,
): Promise<boolean> {
  return await verifyInternalControlPlaneSignature(req, url, undefined, logger);
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
  logger?: InternalControlPlaneSignatureLogger,
): Promise<boolean> {
  if (!binding.audience) return false;
  return await verifyInternalControlPlaneSignature(req, url, binding, logger);
}
