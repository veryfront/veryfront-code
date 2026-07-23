import { createOAuthCallbackHandler, notionConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(notionConfig, {
  tokenStore: oauthTokenStore,
});
