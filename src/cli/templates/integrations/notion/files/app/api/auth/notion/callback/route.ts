/**
 * Notion OAuth Callback
 */

import { createOAuthCallbackHandler, memoryTokenStore, notionConfig } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(notionConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
