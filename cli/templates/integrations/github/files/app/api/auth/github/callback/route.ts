import { createOAuthCallbackHandler, githubConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(githubConfig, {
  tokenStore: oauthTokenStore,
});
