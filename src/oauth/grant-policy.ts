import type { OAuthTokens } from "./types.ts";

const DRIVE_SERVICE_ID = "drive";
const OUTLOOK_SERVICE_ID = "outlook";

const SUPERSEDED_DRIVE_FULL_ACCESS_SCOPE = "https://www.googleapis.com/auth/drive";
const SUPERSEDED_OUTLOOK_GROUP_SCOPES = new Set([
  "Group.Read.All",
  "Group-Conversation.Read.All",
]);

function scopeEntries(tokens: OAuthTokens): string[] {
  return typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean) : [];
}

/**
 * Whether a stored OAuth token carries a default broad grant that a current
 * service narrowed. Explicit caller-requested grants stay valid.
 */
export function isSupersededOAuthGrant(serviceId: string, tokens: OAuthTokens): boolean {
  if (tokens.scopeSource === "explicit") return false;
  const scopes = scopeEntries(tokens);
  if (serviceId === DRIVE_SERVICE_ID) {
    return scopes.includes(SUPERSEDED_DRIVE_FULL_ACCESS_SCOPE);
  }
  if (serviceId === OUTLOOK_SERVICE_ID) {
    return scopes.some((scope) => SUPERSEDED_OUTLOOK_GROUP_SCOPES.has(scope));
  }
  return false;
}
