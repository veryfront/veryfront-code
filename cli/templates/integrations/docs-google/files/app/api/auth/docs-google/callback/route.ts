import { createOAuthCallbackHandler, docsGoogleConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(docsGoogleConfig, {
  tokenStore: oauthTokenStore,
});
