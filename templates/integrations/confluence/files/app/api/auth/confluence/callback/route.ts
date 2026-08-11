import { createOAuthCallbackHandler, confluenceConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(confluenceConfig, { tokenStore });
