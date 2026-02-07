import { createOAuthInitHandler, figmaConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(figmaConfig, { tokenStore: oauthMemoryTokenStore });
