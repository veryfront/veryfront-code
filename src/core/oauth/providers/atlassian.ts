/**
 * Atlassian OAuth Provider
 *
 * Pre-configured OAuth for Atlassian services: Jira, Confluence
 */

import type { OAuthServiceConfig } from "../types.ts";

/**
 * Base Atlassian OAuth configuration
 */
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
};

/**
 * Jira OAuth configuration
 */
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

/**
 * Confluence OAuth configuration
 */
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

/**
 * Bitbucket OAuth configuration (also Atlassian)
 */
export const bitbucketConfig: OAuthServiceConfig = {
  ...atlassianBase,
  serviceId: "bitbucket",
  displayName: "Bitbucket",
  // Bitbucket has its own OAuth endpoints
  authorizationUrl: "https://bitbucket.org/site/oauth2/authorize",
  tokenUrl: "https://bitbucket.org/site/oauth2/access_token",
  clientIdEnvVar: "BITBUCKET_CLIENT_ID",
  clientSecretEnvVar: "BITBUCKET_CLIENT_SECRET",
  apiBaseUrl: "https://api.bitbucket.org/2.0",
  additionalAuthParams: {},
  defaultScopes: [
    "repository",
    "repository:write",
    "pullrequest",
    "pullrequest:write",
    "account",
  ],
};

/**
 * All Atlassian service configurations
 */
export const atlassianServices = {
  jira: jiraConfig,
  confluence: confluenceConfig,
  bitbucket: bitbucketConfig,
} as const;
