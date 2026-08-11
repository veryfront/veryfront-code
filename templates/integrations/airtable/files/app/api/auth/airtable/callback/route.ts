import { createOAuthCallbackHandler, airtableConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(airtableConfig, { tokenStore });
