/**
 * OAuth Module
 *
 * Provides reusable OAuth utilities for service integrations.
 * Reduces boilerplate code per integration by ~50%.
 *
 * @example
 * // app/api/auth/gmail/route.ts
 * import { createOAuthInitHandler, createGmailConfig } from "@veryfront/oauth";
 * export const GET = createOAuthInitHandler({ config: createGmailConfig() });
 *
 * @example
 * // app/api/auth/gmail/callback/route.ts
 * import { createOAuthCallbackHandler, createGmailConfig } from "@veryfront/oauth";
 * export const GET = createOAuthCallbackHandler({ config: createGmailConfig() });
 *
 * @module oauth
 */

// Types
export type {
  OAuthErrorResponse,
  OAuthHandlerOptions,
  OAuthProviderConfig,
  OAuthTokenResponse,
  ServiceOAuthConfig,
  TokenData,
  TokenStore,
} from "./types.ts";

// Token Store
export {
  getKVTokenStore,
  getMemoryTokenStore,
  getTokenStore,
  KVTokenStore,
  MemoryTokenStore,
} from "./token-store.ts";

// Providers
export {
  ATLASSIAN_OAUTH,
  createCalendarConfig,
  createConfluenceConfig,
  // Service config factories
  createGmailConfig,
  createJiraConfig,
  createOutlookConfig,
  createSheetsConfig,
  createTeamsConfig,
  getProviderConfig,
  GITHUB_OAUTH,
  // Base provider configs
  GOOGLE_OAUTH,
  HUBSPOT_OAUTH,
  MICROSOFT_OAUTH,
  NOTION_OAUTH,
  // Provider registry
  PROVIDERS,
  SALESFORCE_OAUTH,
  SLACK_OAUTH,
} from "./providers.ts";

// Handlers
export {
  buildAuthorizationUrl,
  createOAuthCallbackHandler,
  createOAuthInitHandler,
  disconnectService,
  exchangeCodeForTokens,
  getValidAccessToken,
  isServiceConnected,
  refreshAccessToken,
} from "./handlers.ts";
