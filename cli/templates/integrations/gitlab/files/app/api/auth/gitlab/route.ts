import { createOAuthInitHandler, gitlabConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(gitlabConfig, { tokenStore: oauthMemoryTokenStore });
