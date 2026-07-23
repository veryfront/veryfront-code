/**
 * Google Drive OAuth Callback
 *
 * Handles the OAuth callback from Google and stores the tokens.
 */

import { createOAuthCallbackHandler, driveConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(driveConfig, {
  tokenStore: oauthTokenStore,
});
