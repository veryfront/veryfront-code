import { createOAuthCallbackHandler, slackConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(slackConfig, { tokenStore });
