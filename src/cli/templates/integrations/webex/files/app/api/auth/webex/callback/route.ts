/**
 * Webex OAuth Callback
 */

import { createOAuthCallbackHandler, memoryTokenStore, webexConfig } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(webexConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
