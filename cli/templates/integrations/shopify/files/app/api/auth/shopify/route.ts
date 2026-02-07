import { createOAuthInitHandler, shopifyConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(shopifyConfig, { tokenStore: oauthMemoryTokenStore });
