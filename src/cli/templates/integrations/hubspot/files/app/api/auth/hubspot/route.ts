import { createOAuthInitHandler, hubspotConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(hubspotConfig, { tokenStore: memoryTokenStore });
