import { createOAuthInitHandler, hubspotConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(hubspotConfig, { tokenStore: oauthMemoryTokenStore });
