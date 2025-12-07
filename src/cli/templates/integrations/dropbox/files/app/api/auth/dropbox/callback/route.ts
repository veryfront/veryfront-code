/**
 * Dropbox OAuth Callback
 */

import { createOAuthCallbackHandler, dropboxConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(dropboxConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
