/**
 * Teams OAuth Callback
 */

import { createOAuthCallbackHandler, memoryTokenStore, teamsConfig } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(teamsConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
