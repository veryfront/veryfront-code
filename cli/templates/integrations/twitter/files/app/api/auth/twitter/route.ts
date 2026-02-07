import { createOAuthInitHandler, twitterConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(twitterConfig, {
  tokenStore: oauthMemoryTokenStore,
});
