import { createOAuthCallbackHandler, salesforceConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(salesforceConfig, {
  tokenStore: oauthTokenStore,
});
