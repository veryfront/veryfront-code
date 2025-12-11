
import { createOAuthInitHandler, memoryTokenStore, driveConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(driveConfig, {
  tokenStore: memoryTokenStore,
});
