import { createOAuthInitHandler, trelloConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(trelloConfig);
