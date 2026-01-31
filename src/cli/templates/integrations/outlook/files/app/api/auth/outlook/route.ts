import { createOAuthInitHandler, memoryTokenStore, outlookConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(outlookConfig, {
  tokenStore: memoryTokenStore,
});
