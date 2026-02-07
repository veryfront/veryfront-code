import { createOAuthInitHandler, mondayConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(mondayConfig, { tokenStore: oauthMemoryTokenStore });
