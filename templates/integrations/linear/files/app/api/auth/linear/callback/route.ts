import { createOAuthCallbackHandler, linearConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(linearConfig, { tokenStore });
