import { createOAuthCallbackHandler, jiraConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(jiraConfig, {
  tokenStore: oauthTokenStore,
});
