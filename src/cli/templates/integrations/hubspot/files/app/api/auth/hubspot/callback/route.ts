/**
 * HubSpot OAuth Callback
 */

import { createOAuthCallbackHandler, hubspotConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(hubspotConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
