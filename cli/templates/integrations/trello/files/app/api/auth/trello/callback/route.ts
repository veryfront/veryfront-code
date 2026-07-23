import { createOAuthCallbackHandler, trelloConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(trelloConfig, {
  tokenStore: oauthTokenStore,
});
