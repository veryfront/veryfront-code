import { createOAuthInitHandler, driveConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(driveConfig, { tokenStore: memoryTokenStore });
