import { createOAuthInitHandler, outlookConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../lib/token-store.ts";
import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";

export const GET = createOAuthInitHandler(outlookConfig, {
  tokenStore,
  getUserId: requireUserIdFromRequest,
});
