/**
 * OAuth Providers Index
 *
 * Export all pre-configured OAuth providers and utilities.
 */

// Base classes
export { type EnvReader, OAuthProvider, OAuthService } from "./base.ts";

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
  asanaConfig,
  boxConfig,
  clickupConfig,
  commonServices,
  discordConfig,
  dropboxConfig,
  figmaConfig,
  freshdeskConfig,
  githubConfig,
  gitlabConfig,
  hubspotConfig,
  intercomConfig,
  linearConfig,
  mailchimpConfig,
  mondayConfig,
  notionConfig,
  pipedriveConfig,
  quickbooksConfig,
  salesforceConfig,
  shopifyConfig,
  slackConfig,
  trelloConfig,
  twitterConfig,
  webexConfig,
  xeroConfig,
  zoomConfig,
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
