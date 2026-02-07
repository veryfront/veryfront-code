import { createOAuthInitHandler, gmailConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(gmailConfig, { tokenStore: oauthMemoryTokenStore });
