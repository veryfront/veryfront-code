/**
 * Freshdesk OAuth Callback
 */

import { freshdeskConfig, createOAuthCallbackHandler, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(freshdeskConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
