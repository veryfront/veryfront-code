import { confluenceConfig, createOAuthCallbackHandler } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(confluenceConfig, {
  tokenStore: oauthTokenStore,
});
