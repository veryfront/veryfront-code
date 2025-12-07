/**
 * GitLab OAuth Callback
 */

import { createOAuthCallbackHandler, gitlabConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(gitlabConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
