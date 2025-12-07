/**
 * Trello OAuth Callback
 */

import { trelloConfig, createOAuthCallbackHandler, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(trelloConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
