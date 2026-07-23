/**
 * Teams OAuth Callback
 *
 * Handles the OAuth callback from Microsoft and stores the tokens.
 */

import { createOAuthCallbackHandler, teamsConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(teamsConfig, {
  tokenStore: oauthTokenStore,
});
