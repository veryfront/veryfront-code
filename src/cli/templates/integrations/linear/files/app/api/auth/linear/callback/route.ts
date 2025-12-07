/**
 * Linear OAuth Callback
 */

import { createOAuthCallbackHandler, linearConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(linearConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
