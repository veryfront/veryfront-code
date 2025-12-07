/**
 * Slack OAuth Callback
 */

import { createOAuthCallbackHandler, memoryTokenStore, slackConfig } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(slackConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
