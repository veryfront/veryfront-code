import { createOAuthCallbackHandler, outlookConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(outlookConfig, {
  tokenStore: oauthTokenStore,
});
