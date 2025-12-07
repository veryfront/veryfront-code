/**
 * Outlook OAuth Callback
 */

import { createOAuthCallbackHandler, memoryTokenStore, outlookConfig } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(outlookConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
