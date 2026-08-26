import type { OAuthTokens } from "./types.ts";

const DRIVE_SERVICE_ID = "drive";
const OUTLOOK_SERVICE_ID = "outlook";

const SUPERSEDED_DRIVE_FULL_ACCESS_SCOPE = "https://www.googleapis.com/auth/drive";
const SUPERSEDED_OUTLOOK_GROUP_SCOPES = new Set([
  "Group.Read.All",
  "Group-Conversation.Read.All",
]);

function scopeEntries(tokens: OAuthTokens): string[] {
  return stringScopeEntries(ownDataValue(tokens, "scope"));
}

/**
 * Whether a stored OAuth token carries a broad built-in grant that the active
 * config no longer requests. Explicit grants remain valid only when the exact
 * broad scope appears in the persisted request snapshot.
 */
export function isSupersededOAuthGrant(
  serviceId: string,
  tokens: OAuthTokens,
  currentDefaultScopes: readonly string[],
): boolean {
  const candidateScopes = new Set(scopeEntries(tokens));
  const configuredDefaults = new Set(currentDefaultScopes);
  const supersededScopes = serviceId === DRIVE_SERVICE_ID
    ? [SUPERSEDED_DRIVE_FULL_ACCESS_SCOPE]
    : serviceId === OUTLOOK_SERVICE_ID
    ? [...SUPERSEDED_OUTLOOK_GROUP_SCOPES]
    : [];
  const broadScopes = supersededScopes.filter((scope) => candidateScopes.has(scope));
  if (broadScopes.length === 0) return false;

  if (ownDataValue(tokens, "scopeSource") === "explicit") {
    const requestedScopes = new Set(stringScopeEntries(ownDataValue(tokens, "requestedScope")));
    return broadScopes.some((scope) => !requestedScopes.has(scope));
  }
  return broadScopes.some((scope) => !configuredDefaults.has(scope));
}

function ownDataValue(
  record: OAuthTokens,
  key: "scope" | "scopeSource" | "requestedScope",
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function stringScopeEntries(scope: unknown): string[] {
  return typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : [];
}
