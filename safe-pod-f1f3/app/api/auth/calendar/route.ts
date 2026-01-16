/**
 * Calendar OAuth Initiation
 */

import { calendarConfig, createOAuthInitHandler, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(calendarConfig, {
  tokenStore: memoryTokenStore,
});
