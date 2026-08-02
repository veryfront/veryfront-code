import { createOAuthCallbackHandler, calendarConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(calendarConfig, { tokenStore });
