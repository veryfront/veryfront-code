/**
 * Salesforce OAuth Initiation
 */

import { createOAuthInitHandler, memoryTokenStore, salesforceConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(salesforceConfig, {
  tokenStore: memoryTokenStore,
});
