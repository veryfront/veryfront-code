import { createOAuthInitHandler, intercomConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(intercomConfig);
