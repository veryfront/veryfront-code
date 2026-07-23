import { createOAuthCallbackHandler, sheetsConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(sheetsConfig, {
  tokenStore: oauthTokenStore,
});
