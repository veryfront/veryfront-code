
import { createOAuthInitHandler, gitlabConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(gitlabConfig, {
  tokenStore: memoryTokenStore,
});
