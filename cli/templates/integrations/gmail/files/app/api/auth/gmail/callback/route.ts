import { createOAuthCallbackHandler, gmailConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(gmailConfig, {
  tokenStore: oauthTokenStore,
});
