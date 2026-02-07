import { createOAuthInitHandler, quickbooksConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(quickbooksConfig, { tokenStore: oauthMemoryTokenStore });
