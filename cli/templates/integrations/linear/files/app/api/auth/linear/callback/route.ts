/**
 * Linear OAuth Callback
 *
 * Handles the OAuth callback from Linear and stores the tokens.
 */

import { createOAuthCallbackHandler, linearConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(linearConfig, {
  tokenStore: oauthTokenStore,
});
