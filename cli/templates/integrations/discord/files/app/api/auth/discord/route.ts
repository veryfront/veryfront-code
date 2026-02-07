import { createOAuthInitHandler, discordConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(discordConfig, {
  tokenStore: oauthMemoryTokenStore,
});
