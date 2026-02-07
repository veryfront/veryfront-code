import { createOAuthInitHandler, mailchimpConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(mailchimpConfig, { tokenStore: oauthMemoryTokenStore });
