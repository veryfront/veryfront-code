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

import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { getHostSecret, hasEnvFileValueSource } from "#veryfront/platform/compat/process/env.ts";
import { getEnvValue } from "#veryfront/cache/backends/helpers.ts";
import { getVerifiedCacheApiCredential } from "#veryfront/cache/verified-api-credential-context.ts";
import { tryGetCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { currentRequestContext } from "#veryfront/platform/request-context-access.ts";

export type CacheRequestContext = {
  token?: string;
  projectId?: string;
  projectSlug?: string;
};

/** The credential and project reference a cache backend read is made under. */
export interface ResolvedCacheAuthority {
  token: string | null;
  projectRef: string | null;
  /** Which context supplied the token. Safe to log; never the token itself. */
  tokenSource: string;
}

const trustedRequestContextAccessor = currentRequestContext;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getCacheRequestContext(): CacheRequestContext | null {
  const ctx = trustedRequestContextAccessor();
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
  const hostPrivateToken = getHostSecret("VERYFRONT_API_TOKEN");
  const hostToken = getHostEnv("VERYFRONT_API_TOKEN");
  const envToken = getEnvValue("VERYFRONT_API_TOKEN");
  const verifiedCredential = getVerifiedCacheApiCredential();
  const verifiedRequestToken = verifiedCredential?.token;
  const cacheKeyContext = tryGetCacheKeyContext();

  // The private verified-request context cannot be changed through the
  // globally exposed filesystem request context.
  const hasRequestSelectedTenant = reqCtx !== null || cacheKeyContext !== null;
  const ambientToken = hasRequestSelectedTenant
    ? reqCtx?.token ?? null
    : hostToken ?? envToken ?? null;
  const token = explicitApiToken ?? verifiedRequestToken ?? ambientToken;
  const tokenSource = explicitApiToken
    ? "explicit-endpoint"
    : verifiedRequestToken
    ? "verified-control-plane"
    : reqCtx?.token
    ? reqCtx.token === hostPrivateToken ? "host-private" : "request"
    : hasRequestSelectedTenant
    ? "none"
    : hostToken && hostToken !== hostPrivateToken &&
        hasEnvFileValueSource("VERYFRONT_API_TOKEN")
    ? "env-file"
    : hostPrivateToken !== undefined && hostToken === hostPrivateToken
    ? "host-private"
    : hostToken
    ? "host-env"
    : envToken
    ? "env"
    : "none";
  const projectRef = verifiedCredential?.projectId || verifiedCredential?.projectSlug ||
    reqCtx?.projectId || reqCtx?.projectSlug ||
    cacheKeyContext?.projectId || null;

  return { token, projectRef, tokenSource };
}

let credentialIdentitySalt: string | null = null;

/**
 * Non-reversible, per-process identity for a cache credential.
 *
 * Used to keep two credentials from sharing a process-local cache scope. The
 * salt is random per process and never leaves it, so the digest is meaningless
 * outside this process and cannot be precomputed. It is not a cryptographic
 * commitment, so callers must also scope on the project reference rather than
 * relying on this alone.
 *
 * Two domain-separated folds are concatenated rather than one, giving a 128-bit
 * identity. This is the widening `cache/keys/dependency-pinning.ts` already
 * applies for the same reason, and it keeps the digest SYNCHRONOUS, which
 * `buildImmutableL1Scope` requires because it runs inline on every read. A
 * single 64-bit fold was already infeasible to collide deliberately here: the
 * salt never leaves the process, so there is no offline search, and a birthday
 * collision would need on the order of 2^63 live credentials inside one short
 * TTL window. But a collision between two live credentials would merge their
 * cache scopes, and widening removes the argument for the cost of one extra
 * pass over a short string, on a path that is otherwise about to make an HTTP
 * round trip.
 */
export function cacheCredentialIdentity(token: string): string {
  credentialIdentitySalt ??= crypto.randomUUID();
  const salted = `${credentialIdentitySalt}\u0000${token}`;
  return `${hashString(`cache-credential:a:${salted}`)}${
    hashString(`cache-credential:b:${salted}`)
  }`;
}
