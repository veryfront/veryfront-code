import { createOAuthInitHandler, driveConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(driveConfig, { tokenStore: oauthMemoryTokenStore });
