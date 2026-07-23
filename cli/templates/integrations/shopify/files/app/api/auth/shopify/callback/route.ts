import { createOAuthCallbackHandler, shopifyConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(shopifyConfig, {
  tokenStore: oauthTokenStore,
});
