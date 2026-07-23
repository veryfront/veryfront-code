import type { OAuthServiceConfig } from "../types.ts";
import { freezeOAuthServiceConfigs } from "./freeze-config.ts";

const atlassianBase = {
  providerId: "atlassian",
  displayName: "Atlassian",
  authorizationUrl: "https://auth.atlassian.com/authorize",
  tokenUrl: "https://auth.atlassian.com/oauth/token",
  userInfoUrl: "https://api.atlassian.com/me",
  clientIdEnvVar: "ATLASSIAN_CLIENT_ID",
  clientSecretEnvVar: "ATLASSIAN_CLIENT_SECRET",
  tokenRequestFormat: "json",
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
    "search:confluence",
    "read:page:confluence",
    "write:page:confluence",
    "offline_access",
  ],
};

/** Configuration used by bitbucket. */
export const bitbucketConfig: OAuthServiceConfig = {
  ...atlassianBase,
  providerId: "bitbucket",
  serviceId: "bitbucket",
  displayName: "Bitbucket",
  authorizationUrl: "https://bitbucket.org/site/oauth2/authorize",
  tokenUrl: "https://bitbucket.org/site/oauth2/access_token",
  userInfoUrl: "https://api.bitbucket.org/2.0/user",
  clientIdEnvVar: "BITBUCKET_CLIENT_ID",
  clientSecretEnvVar: "BITBUCKET_CLIENT_SECRET",
  tokenRequestFormat: "form",
  useBasicAuth: true,
  apiBaseUrl: "https://api.bitbucket.org/2.0",
  additionalAuthParams: {},
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

freezeOAuthServiceConfigs(atlassianServices);
