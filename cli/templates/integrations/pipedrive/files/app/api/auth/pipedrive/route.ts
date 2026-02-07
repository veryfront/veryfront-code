import { createOAuthInitHandler, pipedriveConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(pipedriveConfig, { tokenStore: oauthMemoryTokenStore });
