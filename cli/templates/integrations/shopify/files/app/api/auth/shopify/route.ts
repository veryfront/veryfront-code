import { createOAuthInitHandler, shopifyConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../lib/oauth-store.ts";
import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";

export const GET = createOAuthInitHandler(shopifyConfig, {
  tokenStore: oauthTokenStore,
  getUserId: requireUserIdFromRequest,
});
