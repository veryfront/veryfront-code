/**
 * Authority resolution for distributed cache reads.
 *
 * `ApiCacheBackend` gates every request on a token plus a project reference
 * resolved from in-process context, before any network call. Anything that
 * caches a backend result in front of that gate has to scope what it holds on
 * the same authority, so the resolution lives here once and both callers share
 * it rather than each re-deriving it and drifting apart.
 *
 * @module cache/request-authority
 */

import { logger as baseLogger } from "#veryfront/utils";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { getEnvValue } from "./backends/helpers.ts";
import { getVerifiedCacheApiCredential } from "./verified-api-credential-context.ts";
import { tryGetCacheKeyContext } from "./cache-key-builder.ts";
import { hashString } from "./hash.ts";

const logger = baseLogger.component("cache-request-authority");

export type CacheRequestContext = {
  token?: string;
  projectId?: string;
  projectSlug?: string;
};

export interface ResolvedCacheAuthority {
  token: string | null;
  projectRef: string | null;
  /** Which context supplied the token. Safe to log; never the token itself. */
  tokenSource: string;
}

let warnedMissingAdapterContract = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getCacheRequestContext(): CacheRequestContext | null {
  const adapter = (globalThis as Record<string, unknown>).__vf_multi_project_adapter;

  // The adapter is installed dynamically, so validate its shape instead of an
  // unchecked cast. If it exists but no longer exposes getCurrentRequestContext
  // (e.g., renamed/moved), the API cache would otherwise silently fail to
  // authenticate forever with only a debug log, so warn once, loudly.
  if (
    adapter !== undefined &&
    !(isRecord(adapter) && typeof adapter.getCurrentRequestContext === "function")
  ) {
    if (!warnedMissingAdapterContract) {
      warnedMissingAdapterContract = true;
      logger.warn("Multi-project adapter present but missing getCurrentRequestContext()");
    }
    return null;
  }

  if (!isRecord(adapter) || typeof adapter.getCurrentRequestContext !== "function") {
    return null;
  }

  const ctx = (adapter.getCurrentRequestContext as () => unknown)();
  return isRecord(ctx) ? (ctx as CacheRequestContext) : null;
}

/**
 * Resolve the credential and project reference a cache backend read would be
 * made under.
 *
 * This only reports whether a token is PRESENT. Whether it is still VALID is
 * decided server side by the API call itself, so a caller that skips that call
 * cannot learn about a revocation from this result.
 */
export function resolveCacheRequestAuthority(
  explicitApiToken?: string,
): ResolvedCacheAuthority {
  const reqCtx = getCacheRequestContext();
  const hostToken = getHostEnv("VERYFRONT_API_TOKEN");
  const envToken = getEnvValue("VERYFRONT_API_TOKEN");
  const verifiedCredential = getVerifiedCacheApiCredential();
  const verifiedRequestToken = verifiedCredential?.token;

  // The private verified-request context cannot be changed through the
  // globally exposed filesystem request context.
  const token = explicitApiToken ?? verifiedRequestToken ?? hostToken ?? reqCtx?.token ??
    envToken ?? null;
  const tokenSource = explicitApiToken
    ? "explicit-endpoint"
    : verifiedRequestToken
    ? "verified-control-plane"
    : hostToken
    ? "host-env"
    : reqCtx?.token
    ? "request"
    : envToken
    ? "env"
    : "none";
  const projectRef = verifiedCredential?.projectId || verifiedCredential?.projectSlug ||
    reqCtx?.projectId || reqCtx?.projectSlug ||
    tryGetCacheKeyContext()?.projectId || null;

  return { token, projectRef, tokenSource };
}

let credentialIdentitySalt: string | null = null;

/**
 * Non-reversible, per-process identity for a cache credential.
 *
 * Used to keep two credentials from sharing a process-local cache scope. The
 * salt is random per process and never leaves it, so the digest is meaningless
 * outside this process and cannot be precomputed. It is not a cryptographic
 * commitment: FNV-1a is a 64-bit fold, so two live credentials could in
 * principle collide, which is why callers must also scope on the project
 * reference rather than relying on this alone.
 */
export function cacheCredentialIdentity(token: string): string {
  credentialIdentitySalt ??= crypto.randomUUID();
  return hashString(`${credentialIdentitySalt}\u0000${token}`);
}
