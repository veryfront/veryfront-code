import {
  MAX_OAUTH_SCOPE_WIRE_LENGTH,
  MAX_OAUTH_TOKEN_REVISION_LENGTH,
  MAX_OAUTH_TOKEN_TYPE_LENGTH,
  MAX_OAUTH_TOKEN_VALUE_LENGTH,
} from "./limits.ts";
import type {
  OAuthTokens,
  OAuthTokenSnapshot,
  RefreshCapableTokenStore,
  TokenStore,
} from "./types.ts";

/** Runtime capability guard for stores that can refresh without lost updates. */
export function isRefreshCapableTokenStore(
  store: TokenStore,
): store is RefreshCapableTokenStore {
  return typeof store.getTokenSnapshot === "function" &&
    typeof store.compareAndSetTokens === "function" &&
    typeof store.withTokenRefreshLock === "function";
}

function ownDataValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function readOptionalTokenString(
  record: object,
  key: string,
  maxLength: number,
): string | null | undefined {
  const value = ownDataValue(record, key);
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" || !value || value.length > maxLength ||
    value.trim() !== value
  ) return null;
  return value;
}

/**
 * Validate and detach a token row crossing an application-provided store
 * boundary. Returns null for malformed rows without invoking property getters.
 */
export function normalizeStoredOAuthTokens(value: unknown): OAuthTokens | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;

    const accessToken = readOptionalTokenString(value, "accessToken", MAX_OAUTH_TOKEN_VALUE_LENGTH);
    if (!accessToken) return null;
    const refreshToken = readOptionalTokenString(
      value,
      "refreshToken",
      MAX_OAUTH_TOKEN_VALUE_LENGTH,
    );
    const tokenType = readOptionalTokenString(value, "tokenType", MAX_OAUTH_TOKEN_TYPE_LENGTH);
    const scope = readOptionalTokenString(value, "scope", MAX_OAUTH_SCOPE_WIRE_LENGTH);
    const idToken = readOptionalTokenString(value, "idToken", MAX_OAUTH_TOKEN_VALUE_LENGTH);
    if (
      refreshToken === null || tokenType === null || scope === null || idToken === null
    ) {
      return null;
    }

    const expiresAt = ownDataValue(value, "expiresAt");
    if (
      expiresAt !== undefined &&
      (!Number.isSafeInteger(expiresAt) || (expiresAt as number) < 0)
    ) {
      return null;
    }

    return {
      accessToken,
      ...(refreshToken === undefined ? {} : { refreshToken }),
      ...(expiresAt === undefined ? {} : { expiresAt: expiresAt as number }),
      ...(tokenType === undefined ? {} : { tokenType }),
      ...(scope === undefined ? {} : { scope }),
      ...(idToken === undefined ? {} : { idToken }),
    };
  } catch {
    return null;
  }
}

/** Validate and detach a revisioned token-store snapshot without invoking getters. */
export function normalizeOAuthTokenSnapshot(value: unknown): OAuthTokenSnapshot | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const revision = ownDataValue(value, "revision");
    if (
      typeof revision !== "string" || !revision || revision.trim() !== revision ||
      revision.length > MAX_OAUTH_TOKEN_REVISION_LENGTH
    ) {
      return null;
    }
    const tokens = normalizeStoredOAuthTokens(ownDataValue(value, "tokens"));
    return tokens ? { revision, tokens } : null;
  } catch {
    return null;
  }
}
