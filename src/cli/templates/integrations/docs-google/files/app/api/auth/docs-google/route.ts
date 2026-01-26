import { createOAuthInitHandler, docsGoogleConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(docsGoogleConfig, { tokenStore: memoryTokenStore });
