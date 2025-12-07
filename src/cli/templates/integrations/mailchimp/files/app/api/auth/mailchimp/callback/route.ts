/**
 * Mailchimp OAuth Callback
 */

import { createOAuthCallbackHandler, mailchimpConfig, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(mailchimpConfig, {
  tokenStore: memoryTokenStore,
  onSuccess: () => "/",
  onError: () => "/",
});
