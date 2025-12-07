/**
 * Notion OAuth Initiation
 */

import { createOAuthInitHandler, memoryTokenStore, notionConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(notionConfig, {
  tokenStore: memoryTokenStore,
});
