import { createOAuthInitHandler, figmaConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(figmaConfig, { tokenStore: memoryTokenStore });
