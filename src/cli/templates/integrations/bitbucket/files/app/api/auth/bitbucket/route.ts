/**
 * Bitbucket OAuth Initiation
 */

import { bitbucketConfig, createOAuthInitHandler, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(bitbucketConfig, {
  tokenStore: memoryTokenStore,
});
