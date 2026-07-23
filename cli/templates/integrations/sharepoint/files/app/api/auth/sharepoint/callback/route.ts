import { createOAuthCallbackHandler, sharePointConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(sharePointConfig, {
  tokenStore: oauthTokenStore,
});
