import { bitbucketConfig, createOAuthInitHandler } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(bitbucketConfig, {
  tokenStore: oauthMemoryTokenStore,
});
