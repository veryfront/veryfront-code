import type { OAuthServiceConfig } from "../types.ts";

const atlassianBase = {
  providerId: "atlassian",
  displayName: "Atlassian",
  authorizationUrl: "https://auth.atlassian.com/authorize",
  tokenUrl: "https://auth.atlassian.com/oauth/token",
  userInfoUrl: "https://api.atlassian.com/me",
  clientIdEnvVar: "ATLASSIAN_CLIENT_ID",
  clientSecretEnvVar: "ATLASSIAN_CLIENT_SECRET",
  additionalAuthParams: {
    audience: "api.atlassian.com",
    prompt: "consent",
  },
} satisfies Omit<OAuthServiceConfig, "serviceId" | "apiBaseUrl" | "defaultScopes">;

/** Configuration used by jira. */
export const jiraConfig: OAuthServiceConfig = {
  ...atlassianBase,
  serviceId: "jira",
  displayName: "Jira",
  apiBaseUrl: "https://api.atlassian.com/ex/jira",
  defaultScopes: [
    "read:jira-work",
    "write:jira-work",
    "read:jira-user",
    "offline_access",
  ],
};

/** Configuration used by confluence. */
export const confluenceConfig: OAuthServiceConfig = {
  ...atlassianBase,
  serviceId: "confluence",
  displayName: "Confluence",
  apiBaseUrl: "https://api.atlassian.com/ex/confluence",
  defaultScopes: [
    "read:confluence-content.all",
    "write:confluence-content",
    "read:confluence-space.summary",
    "read:confluence-user",
    "offline_access",
  ],
};

export const atlassianServices = {
  jira: jiraConfig,
  confluence: confluenceConfig,
} as const;
