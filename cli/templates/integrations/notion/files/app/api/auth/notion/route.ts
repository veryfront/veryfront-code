import { createOAuthInitHandler, notionConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(notionConfig, { tokenStore: oauthMemoryTokenStore });
