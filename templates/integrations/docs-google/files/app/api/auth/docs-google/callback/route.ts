import { createOAuthCallbackHandler, docsGoogleConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(docsGoogleConfig, { tokenStore });
