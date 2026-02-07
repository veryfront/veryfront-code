import { createOAuthInitHandler, zoomConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(zoomConfig, { tokenStore: oauthMemoryTokenStore });
