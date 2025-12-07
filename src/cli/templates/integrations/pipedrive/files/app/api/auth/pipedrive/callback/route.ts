/**
 * Pipedrive OAuth Callback
 */

import { pipedriveConfig, createOAuthCallbackHandler, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(pipedriveConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
