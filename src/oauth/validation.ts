const MAX_JSON_DEPTH = 64;
export const OAUTH_STATE_EXPIRY_MS = 10 * 60 * 1_000;
export const OAUTH_STATE_CLOCK_SKEW_MS = 60_000;
export const OAUTH_MAX_TOKEN_LENGTH = 1_048_576;
export const OAUTH_MAX_TOKEN_METADATA_LENGTH = 4_096;

export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Return whether a URL is HTTPS, or HTTP on an explicit loopback host. */
export function isSecureHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" ||
      (url.protocol === "http:" && isLoopbackHostname(url.hostname))) &&
      url.hostname.length > 0 && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

/** OAuth 2.0 scope-token grammar from RFC 6749 section 3.3. */
export function isOAuthScopeToken(value: string): boolean {
  if (value.length === 0) return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      code !== 0x21 && !(code >= 0x23 && code <= 0x5b) &&
      !(code >= 0x5d && code <= 0x7e)
    ) return false;
  }
  return true;
}

/** Validate the bounded token shape accepted from persistence adapters. */
export function isValidOAuthTokens(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const tokens = value as Record<string, unknown>;
  if (
    typeof tokens.accessToken !== "string" || tokens.accessToken.trim().length === 0 ||
    tokens.accessToken.length > OAUTH_MAX_TOKEN_LENGTH
  ) return false;
  for (const token of [tokens.refreshToken, tokens.idToken]) {
    if (
      token !== undefined &&
      (typeof token !== "string" || token.trim().length === 0 ||
        token.length > OAUTH_MAX_TOKEN_LENGTH)
    ) return false;
  }
  if (
    tokens.expiresAt !== undefined &&
    (typeof tokens.expiresAt !== "number" || !Number.isSafeInteger(tokens.expiresAt) ||
      tokens.expiresAt < 0)
  ) return false;
  if (
    tokens.tokenType !== undefined &&
    (typeof tokens.tokenType !== "string" || tokens.tokenType.trim().length === 0 ||
      tokens.tokenType.length > OAUTH_MAX_TOKEN_METADATA_LENGTH)
  ) return false;
  return tokens.scope === undefined ||
    (typeof tokens.scope === "string" &&
      tokens.scope.length <= OAUTH_MAX_TOKEN_METADATA_LENGTH);
}

/** Return whether a value can be persisted and reproduced as JSON without loss. */
export function isJsonCompatible(
  value: unknown,
  ancestors = new WeakSet<object>(),
  depth = 0,
): boolean {
  if (depth > MAX_JSON_DEPTH) return false;
  if (
    value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value !== "object" || ancestors.has(value)) return false;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false;
      if (Object.getOwnPropertySymbols(value).length > 0) return false;
      if (Object.keys(value).length !== value.length) return false;
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (key === "length") continue;
        const index = Number(key);
        if (
          !Number.isSafeInteger(index) || index < 0 || index >= value.length ||
          String(index) !== key || !descriptor.enumerable || descriptor.get || descriptor.set
        ) {
          return false;
        }
      }
      for (let index = 0; index < value.length; index++) {
        if (!(index in value) || !isJsonCompatible(value[index], ancestors, depth + 1)) {
          return false;
        }
      }
      return true;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (Object.getOwnPropertySymbols(value).length > 0) return false;
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (
        !descriptor.enumerable || descriptor.get || descriptor.set ||
        !isJsonCompatible(descriptor.value, ancestors, depth + 1)
      ) {
        return false;
      }
    }
    return true;
  } finally {
    ancestors.delete(value);
  }
}
