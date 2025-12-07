/**
 * Salesforce OAuth Callback
 */

import { createOAuthCallbackHandler, memoryTokenStore, salesforceConfig } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(salesforceConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
