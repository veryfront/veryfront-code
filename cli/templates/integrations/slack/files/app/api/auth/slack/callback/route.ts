import { createOAuthCallbackHandler, slackConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(slackConfig, {
  tokenStore: oauthTokenStore,
});
