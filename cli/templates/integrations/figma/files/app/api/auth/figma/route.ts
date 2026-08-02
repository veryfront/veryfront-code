import { createOAuthInitHandler, figmaConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../lib/token-store.ts";
import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";

function getUserId(request: Request): string {
  return requireUserIdFromRequest(request);
}

export const GET = createOAuthInitHandler(figmaConfig, {
  tokenStore,
  getUserId,
});
