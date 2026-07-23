import { createOAuthCallbackHandler, gitlabConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(gitlabConfig, {
  tokenStore: oauthTokenStore,
});
