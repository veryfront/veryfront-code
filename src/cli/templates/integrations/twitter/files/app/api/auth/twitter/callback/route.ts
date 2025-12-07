/**
 * Twitter OAuth Callback
 */

import { createOAuthCallbackHandler, memoryTokenStore, twitterConfig } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(twitterConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
