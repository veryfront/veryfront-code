import { createOAuthInitHandler, oneDriveConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

// TODO: Replace with real user ID from your auth system (e.g., session cookie, JWT).
// NEVER return a shared constant in production - it breaks per-user token isolation (VULN-AUTH-2).
function getUserId(_request: Request): string {
  return "current-user";
}

export const GET = createOAuthInitHandler(oneDriveConfig, {
  tokenStore: oauthMemoryTokenStore,
  getUserId,
});