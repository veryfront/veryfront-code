import { createOAuthInitHandler, memoryTokenStore, oneDriveConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(oneDriveConfig, {
  tokenStore: memoryTokenStore,
});
