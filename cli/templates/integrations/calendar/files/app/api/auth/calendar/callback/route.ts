/**
 * Calendar OAuth Callback
 *
 * Handles the OAuth callback from Google and stores the tokens.
 */

import { calendarConfig, createOAuthCallbackHandler } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(calendarConfig, {
  tokenStore: oauthTokenStore,
});
