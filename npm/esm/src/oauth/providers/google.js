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
export const gmailConfig = {
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
export const calendarConfig = {
    ...googleBase,
    serviceId: "calendar",
    displayName: "Google Calendar",
    apiBaseUrl: "https://www.googleapis.com/calendar/v3",
    defaultScopes: [
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
    ],
};
export const sheetsConfig = {
    ...googleBase,
    serviceId: "sheets",
    displayName: "Google Sheets",
    apiBaseUrl: "https://sheets.googleapis.com/v4",
    defaultScopes: [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/spreadsheets",
    ],
};
export const driveConfig = {
    ...googleBase,
    serviceId: "drive",
    displayName: "Google Drive",
    apiBaseUrl: "https://www.googleapis.com/drive/v3",
    defaultScopes: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file",
    ],
};
export const googleServices = {
    gmail: gmailConfig,
    calendar: calendarConfig,
    sheets: sheetsConfig,
    drive: driveConfig,
};
