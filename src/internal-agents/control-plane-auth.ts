import type { HostedServiceRunEventAppendTokenResult } from "#veryfront/agent/service/auth.ts";
import { readOwnDataProperty } from "#veryfront/agent/runtime/data-property-descriptor.ts";
import {
  type ControlPlaneClaims,
  type ControlPlaneSurface,
  verifyControlPlaneJws,
} from "#veryfront/channels/control-plane.ts";
import { getHostBootEnv, getHostEnv } from "#veryfront/platform/compat/process/env.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import {
  readPlatformToolDependencies,
  type VerifiedPlatformToolDependencies,
} from "#veryfront/agent/service/platform-tool-dependency-claims.ts";
import type { HandlerContext } from "#veryfront/types";
import { serverLogger } from "#veryfront/utils";
import { HTTP_INTERNAL_SERVER_ERROR } from "#veryfront/utils/constants/index.ts";

import { getRecoveryAdmissionSchema, type RecoveryAdmission } from "./recovery-admission-schema.ts";

const CONTROL_PLANE_JWS_HEADER = "x-veryfront-control-plane-jws";
const MAX_CONTROL_PLANE_SIGNATURE_AGE_SECONDS = 60;
const CONTROL_PLANE_SIGNING_KEY_ENV = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const logger = serverLogger.component("internal-agents-auth");
const IntrinsicReflectApply = Reflect.apply;
const JsonParse = JSON.parse;
const DateNow = Date.now;
const ObjectFreeze = Object.freeze;
const ObjectHasOwn = Object.hasOwn;
const ArrayIsArray = Array.isArray;
const verifiedPlatformGrants = createPrivateWeakStore<
  object,
  Readonly<
    {
      projectId: string;
      runId: string;
      agentId: string;
      expiresAt: number;
      dependencies: VerifiedPlatformToolDependencies;
    }
  >
>();

const verifiedRecoveryGrants = createPrivateWeakStore<object, RecoveryAdmission>();

/** Only an exact-body signature from the operator boot key can carry recovery authority. */
export function getVerifiedControlPlaneRecoveryAdmission(
  claims: VerifiedControlPlaneRequestClaims,
): RecoveryAdmission | undefined {
  const grant = verifiedRecoveryGrants.get(claims);
  return grant && grant.expiresAt > DateNow() / 1000 ? grant : undefined;
}

/** Read a private exact-body operator grant. Compatibility adapter signatures cannot mint it. */
export function getVerifiedControlPlanePlatformDependencies(
  claims: VerifiedControlPlaneRequestClaims | HostedServiceRunEventAppendTokenResult,
  scope: { projectId: string; runId: string; agentId: string },
): VerifiedPlatformToolDependencies | undefined {
  const grant = verifiedPlatformGrants.get(claims);
  return grant && grant.expiresAt > DateNow() / 1000 && grant.projectId === scope.projectId &&
      grant.runId === scope.runId && grant.agentId === scope.agentId
    ? grant.dependencies
    : undefined;
}

declare const verifiedControlPlaneRequestBrand: unique symbol;

export type VerifiedControlPlaneRequestClaims = ControlPlaneClaims & {
  readonly [verifiedControlPlaneRequestBrand]: true;
};

export interface VerifiedControlPlaneCacheCredential {
  readonly token: string;
  readonly projectId: string;
  readonly projectSlug: string;
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
    const body = IntrinsicReflectApply(JsonParse, JSON, [rawBody]) as Record<string, unknown>;
    const credentials = body.credentials;
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
      return null;
    }

    const token = body.sourceProject
      ? (credentials as Record<string, unknown>).sourceAuthToken
      : (credentials as Record<string, unknown>).authToken;
    if (typeof token !== "string" || token.length === 0) return null;

    return Object.freeze({
      token,
      projectId: claims.project_id,
      projectSlug: claims.aud,
    });
  } catch {
    return null;
  }
}

export function consumeVerifiedControlPlaneCacheCredential(
  claims: VerifiedControlPlaneRequestClaims,
): VerifiedControlPlaneCacheCredential | null {
  const grant = verifiedCacheCredentials.get(claims);
  verifiedCacheCredentials.delete(claims);
  if (!grant || grant.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  return grant.credential;
}

export class ControlPlaneRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ControlPlaneRequestError";
  }
}

export function getControlPlaneVerificationPublicKey(ctx: HandlerContext): string | undefined {
  // Project env overlays intentionally hide host secrets from request-scoped reads.
  // Control-plane verification is framework-owned config, so it must fall back to
  // the host environment when the runtime adapter env is overlay-aware.
  return ctx.adapter.env.get(CONTROL_PLANE_SIGNING_KEY_ENV) ??
    getHostEnv(CONTROL_PLANE_SIGNING_KEY_ENV);
}

export async function verifyControlPlaneRequest(
  req: Request,
  ctx: HandlerContext,
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
    const requestMethod = req.method;
    const requestPath = new URL(req.url).pathname;
    const verificationOptions = Object.freeze({
      audience: projectSlug,
      expectedProjectId: ctx.projectId,
      expectedSubject: options.expectedSubject,
      expectedSurface: options.expectedSurface,
      publicKeyPem,
      maxAgeSeconds: MAX_CONTROL_PLANE_SIGNATURE_AGE_SECONDS,
      requestMethod,
      requestPath,
    });
    const claims = await verifyControlPlaneJws(
      controlPlaneJws,
      rawBody,
      verificationOptions,
    );
    const verifiedClaims = claims as VerifiedControlPlaneRequestClaims;
    // This new authority uses the operator's value captured before tenant env
    // loading. Legacy transport/cache compatibility deliberately stays separate.
    const pinnedKey = getHostBootEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
    let body: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = IntrinsicReflectApply(JsonParse, JSON, [rawBody]);
      if (parsed !== null && typeof parsed === "object" && !ArrayIsArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      // A valid signature can cover a plain cancel or malformed resume body.
      // The handler owns payload validation; no dependency grant is minted.
    }
    if (body && ObjectHasOwn(body, "managedRecoveryAdmission") && pinnedKey) {
      // Adapter compatibility keys are not operator recovery authority.
      await verifyControlPlaneJws(controlPlaneJws, rawBody, {
        ...verificationOptions,
        publicKeyPem: pinnedKey,
      });
      const admission = getRecoveryAdmissionSchema().parse(
        readOwnDataProperty(body, "managedRecoveryAdmission", "Managed recovery admission"),
      );
      if (
        admission.identity.publicRunId !== claims.sub ||
        admission.sourceBinding.projectId !== claims.project_id ||
        admission.expiresAt > claims.exp || admission.expiresAt <= DateNow() / 1000
      ) throw new Error("Managed recovery admission scope is invalid");
      ObjectFreeze(admission.identity);
      ObjectFreeze(admission.generation);
      ObjectFreeze(admission.sourceBinding);
      verifiedRecoveryGrants.set(verifiedClaims, ObjectFreeze(admission));
    }
    if (body && ObjectHasOwn(body, "platformToolDependencies")) {
      const dependencies = readPlatformToolDependencies(
        readOwnDataProperty(body, "platformToolDependencies", "Platform dependencies"),
      );
      if (pinnedKey) {
        let operatorVerified = pinnedKey === publicKeyPem;
        if (!operatorVerified) {
          try {
            await verifyControlPlaneJws(controlPlaneJws, rawBody, {
              ...verificationOptions,
              publicKeyPem: pinnedKey,
            });
            operatorVerified = true;
          } catch { /* Adapter compatibility never grants platform dependencies. */ }
        }
        if (operatorVerified) {
          const run = readOwnDataProperty(body, "run", "Platform dependency scope");
          const project = readOwnDataProperty(run, "project", "Platform dependency scope");
          const runId = readOwnDataProperty(run, "runId", "Platform dependency scope");
          const agentId = readOwnDataProperty(run, "agentId", "Platform dependency scope");
          const projectId = readOwnDataProperty(project, "projectId", "Platform dependency scope");
          let authenticatedProjectId = projectId;
          if (ObjectHasOwn(body, "sourceProject") || ObjectHasOwn(body, "executionProject")) {
            const sourceProject = readOwnDataProperty(
              body,
              "sourceProject",
              "Platform dependency scope",
            );
            const executionProject = readOwnDataProperty(
              body,
              "executionProject",
              "Platform dependency scope",
            );
            authenticatedProjectId = readOwnDataProperty(
              sourceProject,
              "projectId",
              "Platform dependency scope",
            );
            const executionProjectId = readOwnDataProperty(
              executionProject,
              "projectId",
              "Platform dependency scope",
            );
            if (executionProjectId !== projectId) {
              throw new Error("Platform dependency scope is invalid");
            }
          }
          if (
            typeof runId !== "string" || runId !== claims.sub ||
            typeof agentId !== "string" || typeof projectId !== "string" ||
            authenticatedProjectId !== claims.project_id
          ) throw new Error("Platform dependency scope is invalid");
          verifiedPlatformGrants.set(
            verifiedClaims,
            ObjectFreeze({
              projectId,
              runId,
              agentId,
              expiresAt: claims.exp,
              dependencies,
            }),
          );
        }
      }
    }
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
  } catch (error) {
    // verifyControlPlaneJws performs only crypto and claim validation with no
    // external I/O — any error it throws means the signature is invalid.
    // Mapping all errors to 401 is the safe-fail path: it avoids leaking
    // internal error detail and doesn't depend on message-string matching
    // that breaks when upstream wording changes.
    logger.warn("Invalid control-plane signature", {
      error,
      projectSlug,
      expectedSubject: options.expectedSubject,
      expectedSurface: options.expectedSurface,
    });
    throw new ControlPlaneRequestError(401, "Invalid control-plane signature");
  }
}
