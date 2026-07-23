import type { StoredOAuthState } from "./types.ts";
import { isOAuthRedirectUrl } from "./url-validation.ts";
import { normalizeOAuthScopeSet } from "./scope-utils.ts";
import { MAX_OAUTH_SERVICE_ID_LENGTH, MAX_OAUTH_USER_ID_LENGTH } from "./limits.ts";

export const DEFAULT_OAUTH_STATE_TTL_MS = 10 * 60 * 1_000;
export const DEFAULT_OAUTH_STATE_CLOCK_SKEW_MS = 60 * 1_000;
export const MAX_OAUTH_STATE_KEY_LENGTH = 1_024;

const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

/** A legacy-compatible state row after all current security fields are proven. */
export type NormalizedStoredOAuthState = StoredOAuthState & {
  redirectUri: string;
  scopes: string[];
};

function ownDataValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

/** Normalize an authenticated identity before it is used in a persistent key. */
export function normalizeOAuthUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= MAX_OAUTH_USER_ID_LENGTH ? normalized : null;
}

export function isFreshOAuthStateTimestamp(
  createdAt: unknown,
  now = Date.now(),
  ttlMs = DEFAULT_OAUTH_STATE_TTL_MS,
  clockSkewMs = DEFAULT_OAUTH_STATE_CLOCK_SKEW_MS,
): createdAt is number {
  return Number.isSafeInteger(createdAt) &&
    (createdAt as number) > 0 &&
    (createdAt as number) <= now + clockSkewMs &&
    now - (createdAt as number) <= ttlMs;
}

/** Copy state before storing or returning it so caller mutation cannot alter ownership. */
export function cloneStoredOAuthState<T extends StoredOAuthState>(state: T): T {
  return structuredClone(state);
}

/** Validate a state row returned by an application-provided persistent store. */
export function normalizeStoredOAuthStateForStorage(
  value: unknown,
  now = Date.now(),
  ttlMs = DEFAULT_OAUTH_STATE_TTL_MS,
  clockSkewMs = DEFAULT_OAUTH_STATE_CLOCK_SKEW_MS,
): NormalizedStoredOAuthState | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;

    const userId = ownDataValue(value, "userId");
    const serviceId = ownDataValue(value, "serviceId");
    const redirectUri = ownDataValue(value, "redirectUri");
    const createdAt = ownDataValue(value, "createdAt");
    const codeVerifier = ownDataValue(value, "codeVerifier");
    const scopes = ownDataValue(value, "scopes");
    const metadata = ownDataValue(value, "metadata");
    const normalizedUserId = normalizeOAuthUserId(userId);

    if (normalizedUserId === null || normalizedUserId !== userId) return null;
    if (
      typeof serviceId !== "string" || serviceId.length > MAX_OAUTH_SERVICE_ID_LENGTH ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(serviceId)
    ) return null;
    if (typeof redirectUri !== "string" || !isOAuthRedirectUrl(redirectUri)) return null;
    if (!isFreshOAuthStateTimestamp(createdAt, now, ttlMs, clockSkewMs)) return null;
    if (
      codeVerifier !== undefined &&
      (typeof codeVerifier !== "string" || !PKCE_VERIFIER_PATTERN.test(codeVerifier))
    ) {
      return null;
    }
    const normalizedScopes = normalizeOAuthScopeSet(scopes);
    if (!normalizedScopes) return null;
    if (
      metadata !== undefined &&
      (metadata === null || typeof metadata !== "object" || Array.isArray(metadata))
    ) {
      return null;
    }

    return cloneStoredOAuthState({
      userId: normalizedUserId,
      serviceId,
      redirectUri,
      createdAt,
      scopes: normalizedScopes,
      ...(codeVerifier === undefined ? {} : { codeVerifier }),
      ...(metadata === undefined ? {} : { metadata: metadata as Record<string, unknown> }),
    });
  } catch {
    return null;
  }
}

/** Validate a consumed row and enforce its transaction-specific bindings. */
export function normalizeStoredOAuthState(
  value: unknown,
  expectedServiceId: string,
  expectedRedirectUri: string,
  now = Date.now(),
  requireCodeVerifier = true,
): NormalizedStoredOAuthState | null {
  const state = normalizeStoredOAuthStateForStorage(value, now);
  return state?.serviceId === expectedServiceId && state.redirectUri === expectedRedirectUri &&
      (!requireCodeVerifier || state.codeVerifier !== undefined)
    ? state
    : null;
}
