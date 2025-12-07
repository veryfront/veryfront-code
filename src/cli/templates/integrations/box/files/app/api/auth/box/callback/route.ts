/**
 * Box OAuth Callback
 */

import { boxConfig, createOAuthCallbackHandler, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(boxConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
