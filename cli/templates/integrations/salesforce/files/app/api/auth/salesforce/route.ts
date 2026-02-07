import { createOAuthInitHandler, salesforceConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(salesforceConfig, {
  tokenStore: oauthMemoryTokenStore,
});
