import { confluenceConfig, createOAuthInitHandler } from "veryfront/oauth";
import {
  atlassianOAuthCallbackRouteId,
  atlassianOAuthScopes,
} from "../../../../lib/atlassian-oauth.generated.ts";
import { oauthTokenStore } from "../../../../lib/oauth-store.ts";
import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";

export const GET = createOAuthInitHandler(confluenceConfig, {
  tokenStore: oauthTokenStore,
  getUserId: requireUserIdFromRequest,
  callbackRouteId: atlassianOAuthCallbackRouteId,
  authOptions: { scopes: atlassianOAuthScopes },
});
