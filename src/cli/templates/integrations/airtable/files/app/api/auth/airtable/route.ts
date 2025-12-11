
import { airtableConfig, createOAuthInitHandler, memoryTokenStore } from "veryfront/oauth";

export const GET = createOAuthInitHandler(airtableConfig, {
  tokenStore: memoryTokenStore,
});
