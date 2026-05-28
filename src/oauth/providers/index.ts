/**
 * OAuth Providers
 *
 * @module oauth/providers
 */

export { type EnvReader, OAuthProvider, OAuthService } from "./base.ts";

export {
  calendarConfig,
  driveConfig,
  gmailConfig,
  googleServices,
  sheetsConfig,
} from "./google.ts";

export {
  microsoftServices,
  oneDriveConfig,
  outlookConfig,
  sharePointConfig,
  teamsConfig,
} from "./microsoft.ts";

export { atlassianServices, confluenceConfig, jiraConfig } from "./atlassian.ts";

export {
  airtableConfig,
  asanaConfig,
  commonServices,
  figmaConfig,
  githubConfig,
  gitlabConfig,
  linearConfig,
  notionConfig,
  slackConfig,
} from "./common.ts";

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
