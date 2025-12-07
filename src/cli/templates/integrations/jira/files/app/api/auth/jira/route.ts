/**
 * Jira OAuth Initiation
 */

import { createOAuthInitHandler, jiraConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(jiraConfig, {
  tokenStore: memoryTokenStore,
});
