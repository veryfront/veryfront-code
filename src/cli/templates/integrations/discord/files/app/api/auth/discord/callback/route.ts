/**
 * Discord OAuth Callback
 */

import { createOAuthCallbackHandler, discordConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(discordConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
