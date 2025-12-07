/**
 * OneDrive OAuth Callback
 */

import { createOAuthCallbackHandler, memoryTokenStore, oneDriveConfig } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(oneDriveConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
