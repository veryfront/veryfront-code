import { createOAuthCallbackHandler, jiraConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(jiraConfig, { tokenStore });
