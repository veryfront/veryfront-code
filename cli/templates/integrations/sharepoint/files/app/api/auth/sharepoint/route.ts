import { createOAuthInitHandler, memoryTokenStore, sharePointConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(sharePointConfig, { tokenStore: memoryTokenStore });
