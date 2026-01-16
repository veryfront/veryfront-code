/**
 * Gmail OAuth Initiation
 *
 * Uses the veryfront/oauth module for simplified OAuth flow.
 */

import { createOAuthInitHandler, gmailConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(gmailConfig, {
  tokenStore: memoryTokenStore,
});
