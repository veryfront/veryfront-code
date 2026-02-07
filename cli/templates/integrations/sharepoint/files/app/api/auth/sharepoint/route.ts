import { createOAuthInitHandler, sharePointConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(sharePointConfig, { tokenStore: oauthMemoryTokenStore });
