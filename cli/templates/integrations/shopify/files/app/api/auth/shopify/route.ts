import { createOAuthInitHandler, shopifyConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../lib/token-store.ts";
import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";

export const GET = createOAuthInitHandler(shopifyConfig, {
  tokenStore,
  getUserId: requireUserIdFromRequest,
});
