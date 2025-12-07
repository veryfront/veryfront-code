/**
 * Common OAuth Providers
 *
 * Pre-configured OAuth service configurations for popular SaaS providers.
 */

import type { OAuthServiceConfig } from "../types.ts";

/**
 * GitHub OAuth configuration
 */
export const githubConfig: OAuthServiceConfig = {
  providerId: "github",
  serviceId: "github",
  displayName: "GitHub",
  authorizationUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  clientIdEnvVar: "GITHUB_CLIENT_ID",
  clientSecretEnvVar: "GITHUB_CLIENT_SECRET",
  apiBaseUrl: "https://api.github.com",
  defaultScopes: ["repo", "user"],
  additionalAuthParams: {},
};

/**
 * Slack OAuth configuration
 */
export const slackConfig: OAuthServiceConfig = {
  providerId: "slack",
  serviceId: "slack",
  displayName: "Slack",
  authorizationUrl: "https://slack.com/oauth/v2/authorize",
  tokenUrl: "https://slack.com/api/oauth.v2.access",
  clientIdEnvVar: "SLACK_CLIENT_ID",
  clientSecretEnvVar: "SLACK_CLIENT_SECRET",
  apiBaseUrl: "https://slack.com/api",
  defaultScopes: ["channels:read", "chat:write", "users:read"],
  additionalAuthParams: {},
};

/**
 * Notion OAuth configuration
 */
export const notionConfig: OAuthServiceConfig = {
  providerId: "notion",
  serviceId: "notion",
  displayName: "Notion",
  authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
  tokenUrl: "https://api.notion.com/v1/oauth/token",
  clientIdEnvVar: "NOTION_CLIENT_ID",
  clientSecretEnvVar: "NOTION_CLIENT_SECRET",
  apiBaseUrl: "https://api.notion.com/v1",
  defaultScopes: [],
  useBasicAuth: true,
  additionalAuthParams: {
    owner: "user",
  },
};

/**
 * Figma OAuth configuration
 */
export const figmaConfig: OAuthServiceConfig = {
  providerId: "figma",
  serviceId: "figma",
  displayName: "Figma",
  authorizationUrl: "https://www.figma.com/oauth",
  tokenUrl: "https://www.figma.com/api/oauth/token",
  clientIdEnvVar: "FIGMA_CLIENT_ID",
  clientSecretEnvVar: "FIGMA_CLIENT_SECRET",
  apiBaseUrl: "https://api.figma.com/v1",
  defaultScopes: ["file_read"],
  additionalAuthParams: {},
};

/**
 * Discord OAuth configuration
 */
export const discordConfig: OAuthServiceConfig = {
  providerId: "discord",
  serviceId: "discord",
  displayName: "Discord",
  authorizationUrl: "https://discord.com/api/oauth2/authorize",
  tokenUrl: "https://discord.com/api/oauth2/token",
  clientIdEnvVar: "DISCORD_CLIENT_ID",
  clientSecretEnvVar: "DISCORD_CLIENT_SECRET",
  apiBaseUrl: "https://discord.com/api/v10",
  defaultScopes: ["identify", "guilds"],
  additionalAuthParams: {},
};

/**
 * Linear OAuth configuration
 */
export const linearConfig: OAuthServiceConfig = {
  providerId: "linear",
  serviceId: "linear",
  displayName: "Linear",
  authorizationUrl: "https://linear.app/oauth/authorize",
  tokenUrl: "https://api.linear.app/oauth/token",
  clientIdEnvVar: "LINEAR_CLIENT_ID",
  clientSecretEnvVar: "LINEAR_CLIENT_SECRET",
  apiBaseUrl: "https://api.linear.app",
  defaultScopes: ["read", "write"],
  additionalAuthParams: {},
};

/**
 * GitLab OAuth configuration
 */
export const gitlabConfig: OAuthServiceConfig = {
  providerId: "gitlab",
  serviceId: "gitlab",
  displayName: "GitLab",
  authorizationUrl: "https://gitlab.com/oauth/authorize",
  tokenUrl: "https://gitlab.com/oauth/token",
  clientIdEnvVar: "GITLAB_CLIENT_ID",
  clientSecretEnvVar: "GITLAB_CLIENT_SECRET",
  apiBaseUrl: "https://gitlab.com/api/v4",
  defaultScopes: ["read_user", "api"],
  additionalAuthParams: {},
};

/**
 * Airtable OAuth configuration
 */
export const airtableConfig: OAuthServiceConfig = {
  providerId: "airtable",
  serviceId: "airtable",
  displayName: "Airtable",
  authorizationUrl: "https://airtable.com/oauth2/v1/authorize",
  tokenUrl: "https://airtable.com/oauth2/v1/token",
  clientIdEnvVar: "AIRTABLE_CLIENT_ID",
  clientSecretEnvVar: "AIRTABLE_CLIENT_SECRET",
  apiBaseUrl: "https://api.airtable.com/v0",
  defaultScopes: ["data.records:read", "data.records:write", "schema.bases:read"],
  useBasicAuth: true,
  additionalAuthParams: {},
};

/**
 * Dropbox OAuth configuration
 */
export const dropboxConfig: OAuthServiceConfig = {
  providerId: "dropbox",
  serviceId: "dropbox",
  displayName: "Dropbox",
  authorizationUrl: "https://www.dropbox.com/oauth2/authorize",
  tokenUrl: "https://api.dropbox.com/oauth2/token",
  clientIdEnvVar: "DROPBOX_CLIENT_ID",
  clientSecretEnvVar: "DROPBOX_CLIENT_SECRET",
  apiBaseUrl: "https://api.dropboxapi.com/2",
  defaultScopes: [],
  additionalAuthParams: {
    token_access_type: "offline",
  },
};

/**
 * HubSpot OAuth configuration
 */
export const hubspotConfig: OAuthServiceConfig = {
  providerId: "hubspot",
  serviceId: "hubspot",
  displayName: "HubSpot",
  authorizationUrl: "https://app.hubspot.com/oauth/authorize",
  tokenUrl: "https://api.hubapi.com/oauth/v1/token",
  clientIdEnvVar: "HUBSPOT_CLIENT_ID",
  clientSecretEnvVar: "HUBSPOT_CLIENT_SECRET",
  apiBaseUrl: "https://api.hubapi.com",
  defaultScopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
  additionalAuthParams: {},
};

/**
 * Salesforce OAuth configuration
 */
export const salesforceConfig: OAuthServiceConfig = {
  providerId: "salesforce",
  serviceId: "salesforce",
  displayName: "Salesforce",
  authorizationUrl: "https://login.salesforce.com/services/oauth2/authorize",
  tokenUrl: "https://login.salesforce.com/services/oauth2/token",
  clientIdEnvVar: "SALESFORCE_CLIENT_ID",
  clientSecretEnvVar: "SALESFORCE_CLIENT_SECRET",
  apiBaseUrl: "https://login.salesforce.com/services/data/v59.0",
  defaultScopes: ["api", "refresh_token"],
  additionalAuthParams: {},
};

/**
 * Twitter/X OAuth configuration
 */
export const twitterConfig: OAuthServiceConfig = {
  providerId: "twitter",
  serviceId: "twitter",
  displayName: "Twitter/X",
  authorizationUrl: "https://twitter.com/i/oauth2/authorize",
  tokenUrl: "https://api.twitter.com/2/oauth2/token",
  clientIdEnvVar: "TWITTER_CLIENT_ID",
  clientSecretEnvVar: "TWITTER_CLIENT_SECRET",
  apiBaseUrl: "https://api.twitter.com/2",
  defaultScopes: ["tweet.read", "users.read", "offline.access"],
  useBasicAuth: true,
  additionalAuthParams: {},
};

/**
 * Export grouped services for convenience
 */
export const commonServices = {
  github: githubConfig,
  slack: slackConfig,
  notion: notionConfig,
  figma: figmaConfig,
  discord: discordConfig,
  linear: linearConfig,
  gitlab: gitlabConfig,
  airtable: airtableConfig,
  dropbox: dropboxConfig,
  hubspot: hubspotConfig,
  salesforce: salesforceConfig,
  twitter: twitterConfig,
};
