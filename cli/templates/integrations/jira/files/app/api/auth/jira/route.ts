import { createOAuthInitHandler, jiraConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";
import { requireUserIdFromRequest } from "../../../../../lib/user-id.ts";

function getUserId(request: Request): string {
  return requireUserIdFromRequest(request);
}

export const GET = createOAuthInitHandler(jiraConfig, {
  tokenStore: oauthMemoryTokenStore,
  getUserId,
});