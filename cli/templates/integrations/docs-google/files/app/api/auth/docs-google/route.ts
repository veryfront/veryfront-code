import { createOAuthInitHandler, docsGoogleConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(docsGoogleConfig, {
  tokenStore: oauthMemoryTokenStore,
});
