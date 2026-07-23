import { createOAuthInitHandler, teamsConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../lib/oauth-store.ts";
import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";

export const GET = createOAuthInitHandler(teamsConfig, {
  tokenStore: oauthTokenStore,
  getUserId: requireUserIdFromRequest,
});
