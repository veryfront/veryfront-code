import { createOAuthInitHandler, outlookConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(outlookConfig, {
  tokenStore: oauthMemoryTokenStore,
});
