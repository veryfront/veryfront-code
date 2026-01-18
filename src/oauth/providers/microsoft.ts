/**
 * Microsoft OAuth Provider
 *
 * Pre-configured OAuth for Microsoft services: Outlook, Teams, SharePoint, OneDrive
 */

import type { OAuthServiceConfig } from "../types.ts";

/**
 * Base Microsoft OAuth configuration
 */
const microsoftBase = {
  providerId: "microsoft",
  displayName: "Microsoft",
  authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  userInfoUrl: "https://graph.microsoft.com/v1.0/me",
  clientIdEnvVar: "MICROSOFT_CLIENT_ID",
  clientSecretEnvVar: "MICROSOFT_CLIENT_SECRET",
  additionalAuthParams: {
    response_mode: "query",
  },
};

/**
 * Microsoft Outlook OAuth configuration
 */
export const outlookConfig: OAuthServiceConfig = {
  ...microsoftBase,
  serviceId: "outlook",
  displayName: "Outlook",
  apiBaseUrl: "https://graph.microsoft.com/v1.0",
  defaultScopes: [
    "Mail.Read",
    "Mail.Send",
    "Mail.ReadWrite",
    "Calendars.Read",
    "Calendars.ReadWrite",
    "User.Read",
    "offline_access",
  ],
};

/**
 * Microsoft Teams OAuth configuration
 */
export const teamsConfig: OAuthServiceConfig = {
  ...microsoftBase,
  serviceId: "teams",
  displayName: "Microsoft Teams",
  apiBaseUrl: "https://graph.microsoft.com/v1.0",
  defaultScopes: [
    "Team.ReadBasic.All",
    "Channel.ReadBasic.All",
    "Chat.Read",
    "Chat.ReadWrite",
    "ChannelMessage.Read.All",
    "User.Read",
    "offline_access",
  ],
};

/**
 * Microsoft SharePoint OAuth configuration
 */
export const sharePointConfig: OAuthServiceConfig = {
  ...microsoftBase,
  serviceId: "sharepoint",
  displayName: "SharePoint",
  apiBaseUrl: "https://graph.microsoft.com/v1.0",
  defaultScopes: [
    "Sites.Read.All",
    "Sites.ReadWrite.All",
    "Files.Read.All",
    "Files.ReadWrite.All",
    "User.Read",
    "offline_access",
  ],
};

/**
 * Microsoft OneDrive OAuth configuration
 */
export const oneDriveConfig: OAuthServiceConfig = {
  ...microsoftBase,
  serviceId: "onedrive",
  displayName: "OneDrive",
  apiBaseUrl: "https://graph.microsoft.com/v1.0",
  defaultScopes: [
    "Files.Read",
    "Files.ReadWrite",
    "Files.Read.All",
    "Files.ReadWrite.All",
    "User.Read",
    "offline_access",
  ],
};

/**
 * All Microsoft service configurations
 */
export const microsoftServices = {
  outlook: outlookConfig,
  teams: teamsConfig,
  sharepoint: sharePointConfig,
  onedrive: oneDriveConfig,
} as const;
