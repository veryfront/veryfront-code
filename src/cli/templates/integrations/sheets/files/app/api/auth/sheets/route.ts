import { createOAuthInitHandler, memoryTokenStore, sheetsConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(sheetsConfig, { tokenStore: memoryTokenStore });
