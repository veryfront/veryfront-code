import { createOAuthInitHandler, jiraConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../lib/oauth-store.ts";
import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";

export const GET = createOAuthInitHandler(jiraConfig, {
  tokenStore: oauthTokenStore,
  getUserId: requireUserIdFromRequest,
});
