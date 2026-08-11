import { createOAuthInitHandler, sharePointConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../lib/token-store.ts";
import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";

export const GET = createOAuthInitHandler(sharePointConfig, {
  tokenStore,
  getUserId: requireUserIdFromRequest,
});
