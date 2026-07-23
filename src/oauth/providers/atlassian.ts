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
  tokenRequestFormat: "json",
  pkceMode: "unsupported",
} satisfies Omit<OAuthServiceConfig, "serviceId" | "apiBaseUrl" | "defaultScopes">;

/** Configuration used by jira. */
export const jiraConfig: OAuthServiceConfig = {
  ...atlassianBase,
  additionalAuthParams: { ...atlassianBase.additionalAuthParams },
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
  additionalAuthParams: { ...atlassianBase.additionalAuthParams },
  serviceId: "confluence",
  displayName: "Confluence",
  apiBaseUrl: "https://api.atlassian.com/ex/confluence",
  defaultScopes: [
    "read:confluence-content.all",
    "write:confluence-content",
    "read:confluence-space.summary",
    "read:confluence-user",
    "search:confluence",
    "read:page:confluence",
    "write:page:confluence",
    "offline_access",
  ],
};

/** Configuration used by bitbucket. */
export const bitbucketConfig: OAuthServiceConfig = {
  ...atlassianBase,
  serviceId: "bitbucket",
  displayName: "Bitbucket",
  authorizationUrl: "https://bitbucket.org/site/oauth2/authorize",
  tokenUrl: "https://bitbucket.org/site/oauth2/access_token",
  clientIdEnvVar: "BITBUCKET_CLIENT_ID",
  clientSecretEnvVar: "BITBUCKET_CLIENT_SECRET",
  apiBaseUrl: "https://api.bitbucket.org/2.0",
  additionalAuthParams: {},
  tokenRequestFormat: "form",
  useBasicAuth: true,
  defaultScopes: [
    "repository",
    "pullrequest:write",
    "issue",
    "account",
  ],
};

export const atlassianServices = {
  jira: jiraConfig,
  confluence: confluenceConfig,
  bitbucket: bitbucketConfig,
} as const;
