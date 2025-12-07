/**
 * Jira OAuth Callback
 */

import { createOAuthCallbackHandler, jiraConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(jiraConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
