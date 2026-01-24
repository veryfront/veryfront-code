import { createOAuthInitHandler, gmailConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(gmailConfig, { tokenStore: memoryTokenStore });
