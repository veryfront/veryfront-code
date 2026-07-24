const MAX_OAUTH_SCOPE_COUNT = 100;
const MAX_OAUTH_SCOPE_TOKEN_LENGTH = 256;
const MAX_OAUTH_SCOPE_WIRE_LENGTH = 4_096;
const OAUTH_SCOPE_TOKEN_PATTERN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

function isOAuthScopeToken(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= MAX_OAUTH_SCOPE_TOKEN_LENGTH &&
    OAUTH_SCOPE_TOKEN_PATTERN.test(value);
}

function readScopeList(
  value: readonly string[],
): Set<string> | null {
  try {
    if (!Array.isArray(value) || value.length > MAX_OAUTH_SCOPE_COUNT) {
      return null;
    }
    const scopes = new Set<string>();
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) return null;
      const scope = descriptor.value;
      if (!isOAuthScopeToken(scope) || scopes.has(scope)) return null;
      scopes.add(scope);
    }
    return scopes;
  } catch {
    return null;
  }
}

function readGrantedScopes(value: unknown): Set<string> | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_OAUTH_SCOPE_WIRE_LENGTH ||
    value.trim() !== value
  ) {
    return null;
  }

  const scopes = value.split(" ");
  if (scopes.length > MAX_OAUTH_SCOPE_COUNT || scopes.join(" ") !== value) {
    return null;
  }

  const result = new Set<string>();
  for (const scope of scopes) {
    if (!isOAuthScopeToken(scope) || result.has(scope)) return null;
    result.add(scope);
  }
  return result;
}

/**
 * Validate a stored OAuth grant against required and explicitly forbidden
 * scopes. Unknown extra scopes remain valid because providers may add implied
 * scopes, while known retired capabilities fail closed.
 */
export function satisfiesOAuthScopePolicy(
  grantedScope: unknown,
  requiredScopes: readonly string[],
  forbiddenScopes: readonly string[],
): boolean {
  const required = readScopeList(requiredScopes);
  const forbidden = readScopeList(forbiddenScopes);
  if (!required || !forbidden) return false;
  for (const scope of required) {
    if (forbidden.has(scope)) return false;
  }
  if (required.size === 0 && forbidden.size === 0) return true;

  const granted = readGrantedScopes(grantedScope);
  if (!granted) return false;
  for (const scope of required) {
    if (!granted.has(scope)) return false;
  }
  for (const scope of forbidden) {
    if (granted.has(scope)) return false;
  }
  return true;
}

/**
 * Prove that a stored OAuth grant covers every scope required by a route.
 *
 * OAuth token endpoint scope values use the RFC 6749 space-delimited wire
 * format. Malformed, duplicate, or over-limit rows fail closed.
 */
export function hasRequiredOAuthScopes(
  grantedScope: unknown,
  requiredScopes: readonly string[],
): boolean {
  return satisfiesOAuthScopePolicy(grantedScope, requiredScopes, []);
}
