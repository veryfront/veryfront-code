import { createOAuthCallbackHandler, figmaConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(figmaConfig, { tokenStore });
