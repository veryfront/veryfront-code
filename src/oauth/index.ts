/**
 * OAuth 2.0 with pre-configured providers.
 *
 * Default supported integrations are visible in the CLI/MCP/runtime connector
 * surface. Additional provider configs are retained for feature-gated
 * integrations enabled with VERYFRONT_EXPERIMENTAL_INTEGRATIONS.
 *
 * @example
 * ```typescript
 * // Create OAuth routes with pre-configured providers
 * import { createOAuthInitHandler, createOAuthCallbackHandler, gmailConfig } from "veryfront/oauth";
 * import { tokenStore } from "./persistent-token-store.ts";
 *
 * // app/api/auth/gmail/route.ts
 * export const GET = createOAuthInitHandler(gmailConfig, {
 *   tokenStore,
 *   getUserId: (request) => getSessionUserId(request),
 * });
 *
 * // app/api/auth/gmail/callback/route.ts
 * export const GET = createOAuthCallbackHandler(gmailConfig, { tokenStore });
 * ```
 *
 * @module oauth
 */

export type {
  AuthorizationUrlOptions,
  OAuthProviderConfig,
  OAuthServiceConfig,
  OAuthState,
  OAuthTokens,
  OAuthTokenSnapshot,
  RefreshCapableTokenStore,
  StoredOAuthState,
  TokenExchangeOptions,
  TokenExchangeResult,
  TokenStore,
} from "./types.ts";

export { OAuthProvider, OAuthService } from "./providers/base.ts";

export {
  AuthorizationUrlOptionsSchema,
  getAuthorizationUrlOptionsSchema,
  getOAuthProviderConfigSchema,
  getOAuthServiceConfigSchema,
  getOAuthStateSchema,
  getOAuthTokensSchema,
  getTokenExchangeOptionsSchema,
  getTokenExchangeResultSchema,
  OAuthProviderConfigSchema,
  OAuthServiceConfigSchema,
  OAuthStateSchema,
  OAuthTokensSchema,
  TokenExchangeOptionsSchema,
  TokenExchangeResultSchema,
} from "./schemas/index.ts";

export {
  airtableConfig,
  asanaConfig,
  bitbucketConfig,
  boxConfig,
  calendarConfig,
  clickupConfig,
  confluenceConfig,
  docsGoogleConfig,
  driveConfig,
  figmaConfig,
  freshdeskConfig,
  githubConfig,
  gitlabConfig,
  gmailConfig,
  hubspotConfig,
  intercomConfig,
  jiraConfig,
  linearConfig,
  mailchimpConfig,
  mondayConfig,
  notionConfig,
  oneDriveConfig,
  outlookConfig,
  pipedriveConfig,
  quickbooksConfig,
  salesforceConfig,
  sharePointConfig,
  sheetsConfig,
  shopifyConfig,
  slackConfig,
  teamsConfig,
  trelloConfig,
  twitterConfig,
  webexConfig,
  xeroConfig,
  zoomConfig,
} from "./providers/index.ts";

export { MemoryTokenStore } from "./token-store/index.ts";
export type { MemoryTokenStoreOptions } from "./token-store/index.ts";

export {
  createOAuthCallbackHandler,
  createOAuthDisconnectHandler,
  createOAuthInitHandler,
  createOAuthStatusHandler,
  type GetUserIdFn,
  type OAuthCallbackHandlerOptions,
  type OAuthDisconnectHandlerOptions,
  type OAuthInitHandlerOptions,
  type OAuthStatusHandlerOptions,
} from "./handlers/index.ts";
