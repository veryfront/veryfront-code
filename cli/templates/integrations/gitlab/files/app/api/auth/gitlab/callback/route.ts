import { createOAuthCallbackHandler, gitlabConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(gitlabConfig, { tokenStore });
