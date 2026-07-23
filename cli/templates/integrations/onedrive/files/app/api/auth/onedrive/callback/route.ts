/**
 * OneDrive OAuth Callback
 *
 * Handles the OAuth callback from Microsoft and stores the tokens.
 */

import { createOAuthCallbackHandler, oneDriveConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(oneDriveConfig, {
  tokenStore: oauthTokenStore,
});
