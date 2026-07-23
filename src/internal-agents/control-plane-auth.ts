import {
  type ControlPlaneClaims,
  type ControlPlaneSurface,
  verifyControlPlaneJws,
} from "#veryfront/channels/control-plane.ts";
export type { ControlPlaneClaims, ControlPlaneSurface } from "#veryfront/channels/control-plane.ts";
export { CONTROL_PLANE_SURFACES } from "#veryfront/channels/control-plane.ts";
import { getRuntimeAgentCredentialsSchema } from "#veryfront/agent/runtime/agent-invocation-contract.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { serverLogger } from "#veryfront/utils";
import { HTTP_INTERNAL_SERVER_ERROR } from "#veryfront/utils/constants/index.ts";

const CONTROL_PLANE_JWS_HEADER = "x-veryfront-control-plane-jws";
const MAX_CONTROL_PLANE_SIGNATURE_AGE_SECONDS = 60;
const CONTROL_PLANE_SIGNING_KEY_ENV = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const logger = serverLogger.component("internal-agents-auth");

declare const verifiedControlPlaneRequestBrand: unique symbol;

/** Control-plane claims that passed signature and request-body verification. */
export type VerifiedControlPlaneRequestClaims = ControlPlaneClaims & {
  readonly [verifiedControlPlaneRequestBrand]: true;
};

/** Cache credential derived from a verified host-signed request. */
export interface VerifiedControlPlaneCacheCredential {
  /** Request-scoped API token. */
  readonly token: string;
  /** Project identifier bound by the verified claims. */
  readonly projectId: string;
  /** Project slug bound by the verified claims. */
  readonly projectSlug: string;
}

/** Minimal request context needed for control-plane verification. */
export interface ControlPlaneVerificationContext {
  /** Runtime adapter that supplies framework configuration. */
  readonly adapter: {
    /** Environment reader for the runtime adapter. */
    readonly env: {
      /** Returns the configured value for an environment key. */
      get(key: string): string | undefined;
    };
  };
  /** Resolved project identifier, when available. */
  readonly projectId?: string;
  /** Resolved project slug used as the signature audience. */
  readonly projectSlug?: string;
}

interface VerifiedControlPlaneCacheCredentialGrant {
  readonly credential: VerifiedControlPlaneCacheCredential | null;
  readonly expiresAt: number;
}

const verifiedCacheCredentials = new WeakMap<
  VerifiedControlPlaneRequestClaims,
  VerifiedControlPlaneCacheCredentialGrant
>();

function extractVerifiedCacheCredential(
  rawBody: string,
  claims: ControlPlaneClaims,
): VerifiedControlPlaneCacheCredential | null {
  try {
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const parsed = getRuntimeAgentCredentialsSchema().safeParse(body.credentials);
    if (!parsed.success) {
      return null;
    }

    return Object.freeze({
      token: parsed.data.authToken,
      projectId: claims.project_id,
      projectSlug: claims.aud,
    });
  } catch {
    return null;
  }
}

/** Consumes the one-time cache credential associated with verified claims. */
export function consumeVerifiedControlPlaneCacheCredential(
  claims: VerifiedControlPlaneRequestClaims,
): VerifiedControlPlaneCacheCredential | null {
  const grant = verifiedCacheCredentials.get(claims);
  verifiedCacheCredentials.delete(claims);
  if (!grant || grant.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  return grant.credential;
}

/** Error mapped to a stable HTTP response for invalid control-plane requests. */
export class ControlPlaneRequestError extends Error {
  /** HTTP status returned for the request failure. */
  readonly status: number;

  /** Creates a control-plane request error. */
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ControlPlaneRequestError";
  }
}

/** Resolves the control-plane verification key from adapter or host configuration. */
export function getControlPlaneVerificationPublicKey(
  ctx: ControlPlaneVerificationContext,
): string | undefined {
  // Project env overlays intentionally hide host secrets from request-scoped reads.
  // Control-plane verification is framework-owned config, so it must fall back to
  // the host environment when the runtime adapter env is overlay-aware.
  return ctx.adapter.env.get(CONTROL_PLANE_SIGNING_KEY_ENV) ??
    getHostEnv(CONTROL_PLANE_SIGNING_KEY_ENV);
}

/** Verifies a signed control-plane request and binds it to the request context. */
export async function verifyControlPlaneRequest(
  req: Request,
  ctx: ControlPlaneVerificationContext,
  rawBody: string,
  options: {
    expectedSubject?: string;
    expectedSurface?: ControlPlaneSurface;
  } = {},
): Promise<VerifiedControlPlaneRequestClaims> {
  const hostPublicKeyPem = getHostEnv(CONTROL_PLANE_SIGNING_KEY_ENV);
  const publicKeyPem = getControlPlaneVerificationPublicKey(ctx);
  if (!publicKeyPem) {
    throw new ControlPlaneRequestError(
      HTTP_INTERNAL_SERVER_ERROR,
      "Control-plane verification is not configured",
    );
  }

  const projectSlug = ctx.projectSlug;
  if (!projectSlug) {
    throw new ControlPlaneRequestError(400, "Project context is unavailable");
  }

  const controlPlaneJws = req.headers.get(CONTROL_PLANE_JWS_HEADER);
  if (!controlPlaneJws) {
    throw new ControlPlaneRequestError(401, "Missing control-plane signature");
  }

  try {
    const verificationOptions = {
      audience: projectSlug,
      expectedProjectId: ctx.projectId,
      expectedSubject: options.expectedSubject,
      expectedSurface: options.expectedSurface,
      publicKeyPem,
      maxAgeSeconds: MAX_CONTROL_PLANE_SIGNATURE_AGE_SECONDS,
    };
    const claims = await verifyControlPlaneJws(
      controlPlaneJws,
      rawBody,
      verificationOptions,
    );
    const verifiedClaims = claims as VerifiedControlPlaneRequestClaims;
    let hostVerified = hostPublicKeyPem === publicKeyPem && Boolean(hostPublicKeyPem);
    if (hostPublicKeyPem && !hostVerified) {
      try {
        await verifyControlPlaneJws(controlPlaneJws, rawBody, {
          ...verificationOptions,
          publicKeyPem: hostPublicKeyPem,
        });
        hostVerified = true;
      } catch {
        // Compatibility verification can still succeed through the adapter,
        // but only the host key may mint the cache credential capability.
      }
    }
    verifiedCacheCredentials.set(
      verifiedClaims,
      Object.freeze({
        credential: hostVerified ? extractVerifiedCacheCredential(rawBody, claims) : null,
        expiresAt: claims.exp,
      }),
    );
    return verifiedClaims;
  } catch {
    // verifyControlPlaneJws performs only crypto and claim validation with no
    // external I/O. Any error it throws means the signature is invalid.
    // Mapping all errors to 401 is the safe-fail path: it avoids leaking
    // internal error detail and doesn't depend on message-string matching
    // that breaks when upstream wording changes.
    logger.warn("Invalid control-plane signature", {
      failureCategory: "signature-invalid",
    });
    throw new ControlPlaneRequestError(401, "Invalid control-plane signature");
  }
}
