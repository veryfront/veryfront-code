import type { StoredOAuthState } from "./types.ts";
import { isOAuthRedirectUrl } from "./url-validation.ts";
import { normalizeOAuthScopeSet } from "./scope-utils.ts";
import { MAX_OAUTH_SERVICE_ID_LENGTH, MAX_OAUTH_USER_ID_LENGTH } from "./limits.ts";
import { type OAuthStateMetadata, snapshotOAuthStateMetadata } from "./state-metadata.ts";

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
  let metadata: OAuthStateMetadata | undefined;
  if (state.metadata !== undefined) {
    const snapshot = snapshotOAuthStateMetadata(state.metadata);
    if (snapshot === null) throw new TypeError("Invalid OAuth state metadata");
    metadata = snapshot;
  }
  return {
    userId: state.userId,
    serviceId: state.serviceId,
    ...(state.codeVerifier === undefined ? {} : { codeVerifier: state.codeVerifier }),
    ...(state.redirectUri === undefined ? {} : { redirectUri: state.redirectUri }),
    ...(state.scopes === undefined ? {} : { scopes: [...state.scopes] }),
    ...(state.scopeSource === undefined ? {} : { scopeSource: state.scopeSource }),
    createdAt: state.createdAt,
    ...(metadata === undefined ? {} : { metadata }),
  } as T;
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
    const scopeSource = ownDataValue(value, "scopeSource");
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
    if (scopeSource !== undefined && scopeSource !== "default" && scopeSource !== "explicit") {
      return null;
    }
    let normalizedMetadata: OAuthStateMetadata | undefined;
    if (metadata !== undefined) {
      const snapshot = snapshotOAuthStateMetadata(metadata);
      if (snapshot === null) return null;
      normalizedMetadata = snapshot;
    }

    return cloneStoredOAuthState<NormalizedStoredOAuthState>({
      userId: normalizedUserId,
      serviceId,
      redirectUri,
      createdAt,
      scopes: normalizedScopes,
      ...(scopeSource === undefined ? {} : { scopeSource }),
      ...(codeVerifier === undefined ? {} : { codeVerifier }),
      ...(normalizedMetadata === undefined ? {} : { metadata: normalizedMetadata }),
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
