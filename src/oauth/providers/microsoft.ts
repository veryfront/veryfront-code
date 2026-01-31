import type { OAuthServiceConfig } from "../types.ts";

const graphApiBaseUrl = "https://graph.microsoft.com/v1.0";

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
} satisfies Omit<OAuthServiceConfig, "serviceId" | "apiBaseUrl" | "defaultScopes">;

export const outlookConfig: OAuthServiceConfig = {
  ...microsoftBase,
  serviceId: "outlook",
  displayName: "Outlook",
  apiBaseUrl: graphApiBaseUrl,
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

export const teamsConfig: OAuthServiceConfig = {
  ...microsoftBase,
  serviceId: "teams",
  displayName: "Microsoft Teams",
  apiBaseUrl: graphApiBaseUrl,
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

export const sharePointConfig: OAuthServiceConfig = {
  ...microsoftBase,
  serviceId: "sharepoint",
  displayName: "SharePoint",
  apiBaseUrl: graphApiBaseUrl,
  defaultScopes: [
    "Sites.Read.All",
    "Sites.ReadWrite.All",
    "Files.Read.All",
    "Files.ReadWrite.All",
    "User.Read",
    "offline_access",
  ],
};

export const oneDriveConfig: OAuthServiceConfig = {
  ...microsoftBase,
  serviceId: "onedrive",
  displayName: "OneDrive",
  apiBaseUrl: graphApiBaseUrl,
  defaultScopes: [
    "Files.Read",
    "Files.ReadWrite",
    "Files.Read.All",
    "Files.ReadWrite.All",
    "User.Read",
    "offline_access",
  ],
};

export const microsoftServices = {
  outlook: outlookConfig,
  teams: teamsConfig,
  sharepoint: sharePointConfig,
  onedrive: oneDriveConfig,
} as const;
