import { createOAuthCallbackHandler, githubConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(githubConfig, { tokenStore });
