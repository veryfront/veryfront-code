/**
 * OAuth Provider Configurations
 *
 * Pre-configured OAuth settings for common providers.
 * These can be extended with service-specific scopes.
 */

import type { OAuthProviderConfig, ServiceOAuthConfig } from "./types.ts";

// ============================================================================
// Provider Base Configurations
// ============================================================================

/**
 * Google OAuth configuration (Gmail, Calendar, Sheets, Drive)
 */
export const GOOGLE_OAUTH: OAuthProviderConfig = {
  provider: "google",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: ["openid", "email", "profile"],
  clientIdEnv: "GOOGLE_CLIENT_ID",
  clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  additionalParams: {
    access_type: "offline",
    prompt: "consent",
  },
  tokenAuthMethod: "post",
  requestRefreshToken: true,
};

/**
 * Microsoft OAuth configuration (Outlook, Teams, SharePoint, OneDrive)
 */
export const MICROSOFT_OAUTH: OAuthProviderConfig = {
  provider: "microsoft",
  authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  scopes: ["openid", "email", "profile", "offline_access"],
  clientIdEnv: "MICROSOFT_CLIENT_ID",
  clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
  tokenAuthMethod: "post",
  requestRefreshToken: true,
};

/**
 * Atlassian OAuth configuration (Jira, Confluence)
 */
export const ATLASSIAN_OAUTH: OAuthProviderConfig = {
  provider: "atlassian",
  authorizationUrl: "https://auth.atlassian.com/authorize",
  tokenUrl: "https://auth.atlassian.com/oauth/token",
  scopes: ["offline_access"],
  clientIdEnv: "ATLASSIAN_CLIENT_ID",
  clientSecretEnv: "ATLASSIAN_CLIENT_SECRET",
  additionalParams: {
    audience: "api.atlassian.com",
  },
  tokenAuthMethod: "post",
  requestRefreshToken: true,
};

/**
 * GitHub OAuth configuration
 */
export const GITHUB_OAUTH: OAuthProviderConfig = {
  provider: "github",
  authorizationUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  scopes: ["read:user", "user:email"],
  clientIdEnv: "GITHUB_CLIENT_ID",
  clientSecretEnv: "GITHUB_CLIENT_SECRET",
  tokenAuthMethod: "post",
};

/**
 * Slack OAuth configuration
 */
export const SLACK_OAUTH: OAuthProviderConfig = {
  provider: "slack",
  authorizationUrl: "https://slack.com/oauth/v2/authorize",
  tokenUrl: "https://slack.com/api/oauth.v2.access",
  scopes: ["chat:write", "channels:read", "users:read"],
  clientIdEnv: "SLACK_CLIENT_ID",
  clientSecretEnv: "SLACK_CLIENT_SECRET",
  tokenAuthMethod: "post",
};

/**
 * Notion OAuth configuration
 */
export const NOTION_OAUTH: OAuthProviderConfig = {
  provider: "notion",
  authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
  tokenUrl: "https://api.notion.com/v1/oauth/token",
  scopes: [],
  clientIdEnv: "NOTION_CLIENT_ID",
  clientSecretEnv: "NOTION_CLIENT_SECRET",
  tokenAuthMethod: "basic",
};

/**
 * Salesforce OAuth configuration
 */
export const SALESFORCE_OAUTH: OAuthProviderConfig = {
  provider: "salesforce",
  authorizationUrl: "https://login.salesforce.com/services/oauth2/authorize",
  tokenUrl: "https://login.salesforce.com/services/oauth2/token",
  scopes: ["api", "refresh_token", "offline_access"],
  clientIdEnv: "SALESFORCE_CLIENT_ID",
  clientSecretEnv: "SALESFORCE_CLIENT_SECRET",
  tokenAuthMethod: "post",
  requestRefreshToken: true,
};

/**
 * HubSpot OAuth configuration
 */
export const HUBSPOT_OAUTH: OAuthProviderConfig = {
  provider: "hubspot",
  authorizationUrl: "https://app.hubspot.com/oauth/authorize",
  tokenUrl: "https://api.hubapi.com/oauth/v1/token",
  scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
  clientIdEnv: "HUBSPOT_CLIENT_ID",
  clientSecretEnv: "HUBSPOT_CLIENT_SECRET",
  tokenAuthMethod: "post",
  requestRefreshToken: true,
};

// ============================================================================
// Service-Specific Configurations
// ============================================================================

/**
 * Create a Gmail service configuration
 */
export function createGmailConfig(callbackPath = "/api/auth/gmail/callback"): ServiceOAuthConfig {
  return {
    ...GOOGLE_OAUTH,
    service: "gmail",
    callbackPath,
    serviceScopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
  };
}

/**
 * Create a Google Calendar service configuration
 */
export function createCalendarConfig(
  callbackPath = "/api/auth/calendar/callback",
): ServiceOAuthConfig {
  return {
    ...GOOGLE_OAUTH,
    service: "calendar",
    callbackPath,
    serviceScopes: [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ],
  };
}

/**
 * Create a Google Sheets service configuration
 */
export function createSheetsConfig(callbackPath = "/api/auth/sheets/callback"): ServiceOAuthConfig {
  return {
    ...GOOGLE_OAUTH,
    service: "sheets",
    callbackPath,
    serviceScopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  };
}

/**
 * Create an Outlook service configuration
 */
export function createOutlookConfig(
  callbackPath = "/api/auth/outlook/callback",
): ServiceOAuthConfig {
  return {
    ...MICROSOFT_OAUTH,
    service: "outlook",
    callbackPath,
    serviceScopes: [
      "Mail.Read",
      "Mail.Send",
      "Calendars.ReadWrite",
    ],
  };
}

/**
 * Create a Teams service configuration
 */
export function createTeamsConfig(callbackPath = "/api/auth/teams/callback"): ServiceOAuthConfig {
  return {
    ...MICROSOFT_OAUTH,
    service: "teams",
    callbackPath,
    serviceScopes: [
      "Chat.ReadWrite",
      "ChannelMessage.Send",
      "Team.ReadBasic.All",
    ],
  };
}

/**
 * Create a Jira service configuration
 */
export function createJiraConfig(callbackPath = "/api/auth/jira/callback"): ServiceOAuthConfig {
  return {
    ...ATLASSIAN_OAUTH,
    service: "jira",
    callbackPath,
    serviceScopes: [
      "read:jira-work",
      "write:jira-work",
      "read:jira-user",
    ],
  };
}

/**
 * Create a Confluence service configuration
 */
export function createConfluenceConfig(
  callbackPath = "/api/auth/confluence/callback",
): ServiceOAuthConfig {
  return {
    ...ATLASSIAN_OAUTH,
    service: "confluence",
    callbackPath,
    serviceScopes: [
      "read:confluence-content.all",
      "write:confluence-content",
      "read:confluence-space.summary",
    ],
  };
}

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * All available provider configurations
 */
export const PROVIDERS: Record<string, OAuthProviderConfig> = {
  google: GOOGLE_OAUTH,
  microsoft: MICROSOFT_OAUTH,
  atlassian: ATLASSIAN_OAUTH,
  github: GITHUB_OAUTH,
  slack: SLACK_OAUTH,
  notion: NOTION_OAUTH,
  salesforce: SALESFORCE_OAUTH,
  hubspot: HUBSPOT_OAUTH,
};

/**
 * Get a provider configuration by name
 */
export function getProviderConfig(provider: string): OAuthProviderConfig | undefined {
  return PROVIDERS[provider];
}
