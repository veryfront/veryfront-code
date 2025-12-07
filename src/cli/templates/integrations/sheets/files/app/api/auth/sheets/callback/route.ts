/**
 * Google Sheets OAuth Callback
 */

import { createOAuthCallbackHandler, memoryTokenStore, sheetsConfig } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(sheetsConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
