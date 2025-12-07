/**
 * Confluence OAuth Initiation
 */

import { confluenceConfig, createOAuthInitHandler, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(confluenceConfig, {
  tokenStore: memoryTokenStore,
});
