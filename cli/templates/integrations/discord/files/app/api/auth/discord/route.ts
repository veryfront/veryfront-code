import { createOAuthInitHandler, discordConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(discordConfig, {
  tokenStore: memoryTokenStore,
});
