import { createOAuthInitHandler, sheetsConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(sheetsConfig, { tokenStore: oauthMemoryTokenStore });
