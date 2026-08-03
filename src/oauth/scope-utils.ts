import {
  MAX_OAUTH_SCOPE_COUNT,
  MAX_OAUTH_SCOPE_TOKEN_LENGTH,
  MAX_OAUTH_SCOPE_WIRE_LENGTH,
} from "./limits.ts";

// RFC 6749 scope-token = %x21 / %x23-5B / %x5D-7E.
const OAUTH_SCOPE_TOKEN_PATTERN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

export function isOAuthScopeToken(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_OAUTH_SCOPE_TOKEN_LENGTH &&
    OAUTH_SCOPE_TOKEN_PATTERN.test(value);
}

export function isValidOAuthScopeSet(
  value: unknown,
  separator: " " | "," = " ",
): value is string[] {
  return normalizeOAuthScopeSet(value, separator) !== null;
}

/** Validate and detach a dense scope array without invoking element getters. */
export function normalizeOAuthScopeSet(
  value: unknown,
  separator: " " | "," = " ",
): string[] | null {
  try {
    if (!Array.isArray(value) || value.length > MAX_OAUTH_SCOPE_COUNT) return null;
    const scopes: string[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) return null;
      const scope = descriptor.value;
      if (!isOAuthScopeToken(scope) || scope.includes(separator)) return null;
      scopes.push(scope);
    }
    return scopes.join(separator).length <= MAX_OAUTH_SCOPE_WIRE_LENGTH ? scopes : null;
  } catch {
    return null;
  }
}
