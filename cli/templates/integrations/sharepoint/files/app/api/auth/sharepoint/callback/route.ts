import { createOAuthCallbackHandler, sharePointConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(sharePointConfig, { tokenStore });
