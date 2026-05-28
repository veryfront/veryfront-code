import type { OAuthServiceConfig } from "../types.ts";

/** Configuration used by github. */
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
};

/** Configuration used by slack. */
export const slackConfig: OAuthServiceConfig = {
  providerId: "slack",
  serviceId: "slack",
  displayName: "Slack",
  authorizationUrl: "https://slack.com/oauth/v2/authorize",
  tokenUrl: "https://slack.com/api/oauth.v2.access",
  clientIdEnvVar: "SLACK_CLIENT_ID",
  clientSecretEnvVar: "SLACK_CLIENT_SECRET",
  apiBaseUrl: "https://slack.com/api",
  defaultScopes: [
    "channels:history",
    "channels:read",
    "chat:write",
    "groups:history",
    "groups:read",
    "im:history",
    "im:read",
    "mpim:history",
    "mpim:read",
    "users:read",
  ],
};

/** Configuration used by notion. */
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

/** Configuration used by figma. */
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
};

/** Configuration used by linear. */
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
};

/** Configuration used by gitlab. */
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
};

/** Configuration used by airtable. */
export const airtableConfig: OAuthServiceConfig = {
  providerId: "airtable",
  serviceId: "airtable",
  displayName: "Airtable",
  authorizationUrl: "https://airtable.com/oauth2/v1/authorize",
  tokenUrl: "https://airtable.com/oauth2/v1/token",
  clientIdEnvVar: "AIRTABLE_CLIENT_ID",
  clientSecretEnvVar: "AIRTABLE_CLIENT_SECRET",
  apiBaseUrl: "https://api.airtable.com/v0",
  defaultScopes: [
    "data.records:read",
    "data.records:write",
    "schema.bases:read",
    "schema.bases:write",
  ],
  useBasicAuth: true,
};

/** Configuration used by asana. */
export const asanaConfig: OAuthServiceConfig = {
  providerId: "asana",
  serviceId: "asana",
  displayName: "Asana",
  authorizationUrl: "https://app.asana.com/-/oauth_authorize",
  tokenUrl: "https://app.asana.com/-/oauth_token",
  clientIdEnvVar: "ASANA_CLIENT_ID",
  clientSecretEnvVar: "ASANA_CLIENT_SECRET",
  apiBaseUrl: "https://app.asana.com/api/1.0",
  defaultScopes: ["default"],
};

export const commonServices = {
  github: githubConfig,
  slack: slackConfig,
  notion: notionConfig,
  figma: figmaConfig,
  linear: linearConfig,
  gitlab: gitlabConfig,
  airtable: airtableConfig,
  asana: asanaConfig,
};
