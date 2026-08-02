import { createOAuthCallbackHandler, teamsConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(teamsConfig, { tokenStore });
