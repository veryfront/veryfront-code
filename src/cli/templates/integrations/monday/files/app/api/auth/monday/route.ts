import { createOAuthInitHandler, mondayConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(mondayConfig);
