
import { createOAuthInitHandler, linearConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(linearConfig, {
  tokenStore: memoryTokenStore,
});
