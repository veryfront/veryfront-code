import { asanaConfig, createOAuthInitHandler } from "veryfront/oauth";
import { tokenStore } from "../../../../lib/token-store.ts";
import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";

export const GET = createOAuthInitHandler(asanaConfig, {
  tokenStore,
  getUserId: requireUserIdFromRequest,
});
