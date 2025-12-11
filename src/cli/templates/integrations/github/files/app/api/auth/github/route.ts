
import { createOAuthInitHandler, githubConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(githubConfig, {
  tokenStore: memoryTokenStore,
});
