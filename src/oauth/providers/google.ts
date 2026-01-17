/**
 * Google OAuth Provider
 *
 * Pre-configured OAuth for Google services: Gmail, Calendar, Sheets, Drive
 */

import type { OAuthServiceConfig } from "../types.ts";

/**
 * Base Google OAuth configuration
 */
const googleBase = {
  providerId: "google",
  displayName: "Google",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
  revocationUrl: "https://oauth2.googleapis.com/revoke",
  clientIdEnvVar: "GOOGLE_CLIENT_ID",
  clientSecretEnvVar: "GOOGLE_CLIENT_SECRET",
  additionalAuthParams: {
    access_type: "offline",
    prompt: "consent",
  },
};

/**
 * Gmail OAuth configuration
 */
export const gmailConfig: OAuthServiceConfig = {
  ...googleBase,
  serviceId: "gmail",
  displayName: "Gmail",
  apiBaseUrl: "https://gmail.googleapis.com/gmail/v1",
  defaultScopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.labels",
  ],
};

/**
 * Google Calendar OAuth configuration
 */
export const calendarConfig: OAuthServiceConfig = {
  ...googleBase,
  serviceId: "calendar",
  displayName: "Google Calendar",
  apiBaseUrl: "https://www.googleapis.com/calendar/v3",
  defaultScopes: [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
};

/**
 * Google Sheets OAuth configuration
 */
export const sheetsConfig: OAuthServiceConfig = {
  ...googleBase,
  serviceId: "sheets",
  displayName: "Google Sheets",
  apiBaseUrl: "https://sheets.googleapis.com/v4",
  defaultScopes: [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
  ],
};

/**
 * Google Drive OAuth configuration
 */
export const driveConfig: OAuthServiceConfig = {
  ...googleBase,
  serviceId: "drive",
  displayName: "Google Drive",
  apiBaseUrl: "https://www.googleapis.com/drive/v3",
  defaultScopes: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ],
};

/**
 * All Google service configurations
 */
export const googleServices = {
  gmail: gmailConfig,
  calendar: calendarConfig,
  sheets: sheetsConfig,
  drive: driveConfig,
} as const;
