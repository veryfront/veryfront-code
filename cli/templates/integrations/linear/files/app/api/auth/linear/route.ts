import { createOAuthInitHandler, linearConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(linearConfig, { tokenStore: oauthMemoryTokenStore });
