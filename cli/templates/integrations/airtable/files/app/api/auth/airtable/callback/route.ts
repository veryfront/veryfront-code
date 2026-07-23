import { airtableConfig, createOAuthCallbackHandler } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(airtableConfig, {
  tokenStore: oauthTokenStore,
});
