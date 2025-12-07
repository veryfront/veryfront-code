/**
 * Google Docs OAuth Callback
 */

import { createOAuthCallbackHandler, memoryTokenStore, docsGoogleConfig } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(docsGoogleConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
