/**
 * OAuth 2.0 with pre-configured providers.
 *
 * Default supported integrations are visible in the CLI/MCP/runtime connector
 * surface. Additional provider configs are retained for feature-gated
 * integrations enabled with VERYFRONT_EXPERIMENTAL_INTEGRATIONS.
 *
 * @example
 * ```typescript
 * import { createOAuthInitHandler, createOAuthCallbackHandler, gmailConfig } from "veryfront/oauth";
 * import { getSessionUserId } from "./auth.ts";
 *
 * export const gmailOAuthInit = createOAuthInitHandler(gmailConfig, {
 *   getUserId: (request) => getSessionUserId(request),
 * });
 * export const gmailOAuthCallback = createOAuthCallbackHandler(gmailConfig);
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
  StoredOAuthState,
  TokenExchangeOptions,
  TokenExchangeResult,
  TokenStore,
} from "./types.ts";

export {
  AuthorizationUrlOptionsSchema,
  OAuthProviderConfigSchema,
  OAuthServiceConfigSchema,
  OAuthStateSchema,
  OAuthTokensSchema,
  StoredOAuthStateSchema,
  TokenExchangeOptionsSchema,
  TokenExchangeResultSchema,
} from "./schemas/index.ts";

export { OAuthProvider, OAuthService } from "./providers/base.ts";
export type { OAuthFetchOptions } from "./providers/base.ts";

export {
  airtableConfig,
  asanaConfig,
  bitbucketConfig,
  boxConfig,
  calendarConfig,
  clickupConfig,
  confluenceConfig,
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
