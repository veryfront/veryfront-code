/**
 * OAuth Module
 *
 * Reusable OAuth 2.0 infrastructure for Veryfront integrations.
 *
 * @example
 * ```typescript
 * // Create OAuth routes with pre-configured providers
 * import { createOAuthInitHandler, createOAuthCallbackHandler, gmailConfig } from "veryfront/oauth";
 *
 * // app/api/auth/gmail/route.ts
 * export const GET = createOAuthInitHandler(gmailConfig);
 *
 * // app/api/auth/gmail/callback/route.ts
 * export const GET = createOAuthCallbackHandler(gmailConfig);
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
  TokenExchangeOptions,
  TokenExchangeResult,
  TokenStore,
} from "./types.ts";

export { OAuthProvider, OAuthService } from "./providers/base.ts";

export {
  airtableConfig,
  asanaConfig,
  bitbucketConfig,
  boxConfig,
  calendarConfig,
  clickupConfig,
  confluenceConfig,
  discordConfig,
  driveConfig,
  dropboxConfig,
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

export {
  createOAuthCallbackHandler,
  createOAuthDisconnectHandler,
  createOAuthInitHandler,
  createOAuthStatusHandler,
  type OAuthCallbackHandlerOptions,
  type OAuthInitHandlerOptions,
} from "./handlers/index.ts";
