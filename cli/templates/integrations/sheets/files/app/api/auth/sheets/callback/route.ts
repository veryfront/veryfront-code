import { createOAuthCallbackHandler, sheetsConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(sheetsConfig, { tokenStore });
