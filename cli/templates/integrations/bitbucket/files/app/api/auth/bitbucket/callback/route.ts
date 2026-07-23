/**
 * Bitbucket OAuth Callback
 *
 * Handles the OAuth callback from Atlassian and stores the tokens.
 */

import { bitbucketConfig, createOAuthCallbackHandler } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackHandler(bitbucketConfig, {
  tokenStore: oauthTokenStore,
});
