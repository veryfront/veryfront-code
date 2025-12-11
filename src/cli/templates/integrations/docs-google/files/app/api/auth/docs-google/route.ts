
import { createOAuthInitHandler, memoryTokenStore, docsGoogleConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(docsGoogleConfig, {
  tokenStore: memoryTokenStore,
});
