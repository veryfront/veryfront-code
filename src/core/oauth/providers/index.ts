/**
 * OAuth Providers Index
 *
 * Export all pre-configured OAuth providers and utilities.
 */

// Base classes
export { OAuthProvider, OAuthService } from "./base.ts";

// Google services
export {
  calendarConfig,
  driveConfig,
  gmailConfig,
  googleServices,
  sheetsConfig,
} from "./google.ts";

// Microsoft services
export {
  microsoftServices,
  oneDriveConfig,
  outlookConfig,
  sharePointConfig,
  teamsConfig,
} from "./microsoft.ts";

// Atlassian services
export { atlassianServices, bitbucketConfig, confluenceConfig, jiraConfig } from "./atlassian.ts";

// Common SaaS services
export {
  airtableConfig,
  commonServices,
  discordConfig,
  dropboxConfig,
  figmaConfig,
  githubConfig,
  gitlabConfig,
  hubspotConfig,
  linearConfig,
  notionConfig,
  salesforceConfig,
  slackConfig,
  twitterConfig,
} from "./common.ts";

// Re-export types
export type {
  AuthorizationUrlOptions,
  OAuthProviderConfig,
  OAuthServiceConfig,
  OAuthState,
  OAuthTokens,
  TokenExchangeOptions,
  TokenExchangeResult,
  TokenStore,
} from "../types.ts";
