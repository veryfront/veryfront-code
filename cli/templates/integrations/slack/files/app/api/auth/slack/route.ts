import { createOAuthInitHandler, slackConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(slackConfig, { tokenStore: oauthMemoryTokenStore });
