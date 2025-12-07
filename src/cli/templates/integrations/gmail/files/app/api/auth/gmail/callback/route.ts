/**
 * Gmail OAuth Callback
 *
 * Uses the veryfront/oauth module for simplified OAuth callback handling.
 */

import { createOAuthCallbackHandler, gmailConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(gmailConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
