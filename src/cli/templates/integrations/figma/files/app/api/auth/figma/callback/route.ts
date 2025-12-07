/**
 * Figma OAuth Callback
 */

import { createOAuthCallbackHandler, figmaConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(figmaConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
