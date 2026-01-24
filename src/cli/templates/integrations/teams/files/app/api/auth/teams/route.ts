import { createOAuthInitHandler, memoryTokenStore, teamsConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(teamsConfig, { tokenStore: memoryTokenStore });
