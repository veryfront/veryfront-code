
import { createOAuthInitHandler, memoryTokenStore, slackConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(slackConfig, {
  tokenStore: memoryTokenStore,
});
