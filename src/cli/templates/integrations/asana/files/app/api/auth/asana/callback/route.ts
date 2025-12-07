/**
 * Asana OAuth Callback
 */

import { asanaConfig, createOAuthCallbackHandler, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(asanaConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
