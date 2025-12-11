
import { createOAuthInitHandler, dropboxConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(dropboxConfig, {
  tokenStore: memoryTokenStore,
});
