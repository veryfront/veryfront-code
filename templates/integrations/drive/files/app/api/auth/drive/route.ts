import { createOAuthInitHandler, driveConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../lib/token-store.ts";
import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";

export const GET = createOAuthInitHandler(driveConfig, {
  tokenStore,
  getUserId: requireUserIdFromRequest,
});
