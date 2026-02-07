import { createOAuthInitHandler, oneDriveConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(oneDriveConfig, {
  tokenStore: oauthMemoryTokenStore,
});
