/**
 * Google Drive OAuth Callback
 */

import { createOAuthCallbackHandler, memoryTokenStore, driveConfig } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(driveConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
