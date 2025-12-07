/**
 * GitHub OAuth Callback
 */

import { createOAuthCallbackHandler, githubConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(githubConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
