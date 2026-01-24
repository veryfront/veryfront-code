import { createOAuthInitHandler, mailchimpConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(mailchimpConfig);
