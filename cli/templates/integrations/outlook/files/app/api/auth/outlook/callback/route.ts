import { createOAuthCallbackHandler, outlookConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(outlookConfig, { tokenStore });
