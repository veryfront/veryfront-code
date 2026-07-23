import { createOAuthCallbackHandler, figmaConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(figmaConfig, {
  tokenStore: oauthTokenStore,
});
