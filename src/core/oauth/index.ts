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

// Types
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

// Base classes
export { OAuthProvider, OAuthService } from "./providers/base.ts";

// Pre-configured providers
export {
  // Common SaaS services
  airtableConfig,
  asanaConfig,
  // Atlassian
  atlassianServices,
  bitbucketConfig,
  boxConfig,
  // Google
  calendarConfig,
  clickupConfig,
  commonServices,
  confluenceConfig,
  discordConfig,
  driveConfig,
  dropboxConfig,
  figmaConfig,
  freshdeskConfig,
  githubConfig,
  gitlabConfig,
  gmailConfig,
  googleServices,
  hubspotConfig,
  intercomConfig,
  jiraConfig,
  linearConfig,
  mailchimpConfig,
  // Microsoft
  microsoftServices,
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

// Token stores
export { MemoryTokenStore, memoryTokenStore } from "./token-store/index.ts";

// Route handlers
export {
  createOAuthCallbackHandler,
  createOAuthDisconnectHandler,
  createOAuthInitHandler,
  createOAuthStatusHandler,
  type OAuthCallbackHandlerOptions,
  type OAuthInitHandlerOptions,
} from "./handlers/index.ts";
