
import { createOAuthInitHandler, memoryTokenStore, twitterConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(twitterConfig, {
  tokenStore: memoryTokenStore,
});
