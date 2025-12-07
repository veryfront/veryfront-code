/**
 * SharePoint OAuth Callback
 */

import { createOAuthCallbackHandler, memoryTokenStore, sharePointConfig } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(sharePointConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
