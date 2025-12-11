
import type { OAuthServiceConfig } from "../types.ts";

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
  additionalAuthParams: {},
};

export const slackConfig: OAuthServiceConfig = {
  providerId: "slack",
  serviceId: "slack",
  displayName: "Slack",
  authorizationUrl: "https://slack.com/oauth/v2/authorize",
  tokenUrl: "https://slack.com/api/oauth.v2.access",
  clientIdEnvVar: "SLACK_CLIENT_ID",
  clientSecretEnvVar: "SLACK_CLIENT_SECRET",
  apiBaseUrl: "https://slack.com/api",
  defaultScopes: ["channels:read", "chat:write", "users:read"],
  additionalAuthParams: {},
};

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
  additionalAuthParams: {},
};

export const discordConfig: OAuthServiceConfig = {
  providerId: "discord",
  serviceId: "discord",
  displayName: "Discord",
  authorizationUrl: "https://discord.com/api/oauth2/authorize",
  tokenUrl: "https://discord.com/api/oauth2/token",
  clientIdEnvVar: "DISCORD_CLIENT_ID",
  clientSecretEnvVar: "DISCORD_CLIENT_SECRET",
  apiBaseUrl: "https://discord.com/api/v10",
  defaultScopes: ["identify", "guilds"],
  additionalAuthParams: {},
};

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
  additionalAuthParams: {},
};

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
  additionalAuthParams: {},
};

export const airtableConfig: OAuthServiceConfig = {
  providerId: "airtable",
  serviceId: "airtable",
  displayName: "Airtable",
  authorizationUrl: "https://airtable.com/oauth2/v1/authorize",
  tokenUrl: "https://airtable.com/oauth2/v1/token",
  clientIdEnvVar: "AIRTABLE_CLIENT_ID",
  clientSecretEnvVar: "AIRTABLE_CLIENT_SECRET",
  apiBaseUrl: "https://api.airtable.com/v0",
  defaultScopes: ["data.records:read", "data.records:write", "schema.bases:read"],
  useBasicAuth: true,
  additionalAuthParams: {},
};

export const dropboxConfig: OAuthServiceConfig = {
  providerId: "dropbox",
  serviceId: "dropbox",
  displayName: "Dropbox",
  authorizationUrl: "https://www.dropbox.com/oauth2/authorize",
  tokenUrl: "https://api.dropbox.com/oauth2/token",
  clientIdEnvVar: "DROPBOX_CLIENT_ID",
  clientSecretEnvVar: "DROPBOX_CLIENT_SECRET",
  apiBaseUrl: "https://api.dropboxapi.com/2",
  defaultScopes: [],
  additionalAuthParams: {
    token_access_type: "offline",
  },
};

export const hubspotConfig: OAuthServiceConfig = {
  providerId: "hubspot",
  serviceId: "hubspot",
  displayName: "HubSpot",
  authorizationUrl: "https://app.hubspot.com/oauth/authorize",
  tokenUrl: "https://api.hubapi.com/oauth/v1/token",
  clientIdEnvVar: "HUBSPOT_CLIENT_ID",
  clientSecretEnvVar: "HUBSPOT_CLIENT_SECRET",
  apiBaseUrl: "https://api.hubapi.com",
  defaultScopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
  additionalAuthParams: {},
};

export const salesforceConfig: OAuthServiceConfig = {
  providerId: "salesforce",
  serviceId: "salesforce",
  displayName: "Salesforce",
  authorizationUrl: "https://login.salesforce.com/services/oauth2/authorize",
  tokenUrl: "https://login.salesforce.com/services/oauth2/token",
  clientIdEnvVar: "SALESFORCE_CLIENT_ID",
  clientSecretEnvVar: "SALESFORCE_CLIENT_SECRET",
  apiBaseUrl: "https://login.salesforce.com/services/data/v59.0",
  defaultScopes: ["api", "refresh_token"],
  additionalAuthParams: {},
};

export const twitterConfig: OAuthServiceConfig = {
  providerId: "twitter",
  serviceId: "twitter",
  displayName: "Twitter/X",
  authorizationUrl: "https://twitter.com/i/oauth2/authorize",
  tokenUrl: "https://api.twitter.com/2/oauth2/token",
  clientIdEnvVar: "TWITTER_CLIENT_ID",
  clientSecretEnvVar: "TWITTER_CLIENT_SECRET",
  apiBaseUrl: "https://api.twitter.com/2",
  defaultScopes: ["tweet.read", "users.read", "offline.access"],
  useBasicAuth: true,
  additionalAuthParams: {},
};

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
  additionalAuthParams: {},
};

export const mondayConfig: OAuthServiceConfig = {
  providerId: "monday",
  serviceId: "monday",
  displayName: "Monday.com",
  authorizationUrl: "https://auth.monday.com/oauth2/authorize",
  tokenUrl: "https://auth.monday.com/oauth2/token",
  clientIdEnvVar: "MONDAY_CLIENT_ID",
  clientSecretEnvVar: "MONDAY_CLIENT_SECRET",
  apiBaseUrl: "https://api.monday.com/v2",
  defaultScopes: ["me:read", "boards:read", "boards:write"],
  additionalAuthParams: {},
};

export const zoomConfig: OAuthServiceConfig = {
  providerId: "zoom",
  serviceId: "zoom",
  displayName: "Zoom",
  authorizationUrl: "https://zoom.us/oauth/authorize",
  tokenUrl: "https://zoom.us/oauth/token",
  clientIdEnvVar: "ZOOM_CLIENT_ID",
  clientSecretEnvVar: "ZOOM_CLIENT_SECRET",
  apiBaseUrl: "https://api.zoom.us/v2",
  defaultScopes: ["meeting:read", "meeting:write", "user:read"],
  useBasicAuth: true,
  additionalAuthParams: {},
};

export const intercomConfig: OAuthServiceConfig = {
  providerId: "intercom",
  serviceId: "intercom",
  displayName: "Intercom",
  authorizationUrl: "https://app.intercom.com/oauth",
  tokenUrl: "https://api.intercom.io/auth/eagle/token",
  clientIdEnvVar: "INTERCOM_CLIENT_ID",
  clientSecretEnvVar: "INTERCOM_CLIENT_SECRET",
  apiBaseUrl: "https://api.intercom.io",
  defaultScopes: [],
  additionalAuthParams: {},
};

export const freshdeskConfig: OAuthServiceConfig = {
  providerId: "freshdesk",
  serviceId: "freshdesk",
  displayName: "Freshdesk",
  authorizationUrl: "https://accounts.freshworks.com/authorize",
  tokenUrl: "https://accounts.freshworks.com/oauth/token",
  clientIdEnvVar: "FRESHDESK_CLIENT_ID",
  clientSecretEnvVar: "FRESHDESK_CLIENT_SECRET",
  apiBaseUrl: "https://domain.freshdesk.com/api/v2",
  defaultScopes: ["freshdesk"],
  additionalAuthParams: {},
};

export const mailchimpConfig: OAuthServiceConfig = {
  providerId: "mailchimp",
  serviceId: "mailchimp",
  displayName: "Mailchimp",
  authorizationUrl: "https://login.mailchimp.com/oauth2/authorize",
  tokenUrl: "https://login.mailchimp.com/oauth2/token",
  clientIdEnvVar: "MAILCHIMP_CLIENT_ID",
  clientSecretEnvVar: "MAILCHIMP_CLIENT_SECRET",
  apiBaseUrl: "https://server.api.mailchimp.com/3.0",
  defaultScopes: [],
  additionalAuthParams: {},
};

export const shopifyConfig: OAuthServiceConfig = {
  providerId: "shopify",
  serviceId: "shopify",
  displayName: "Shopify",
  authorizationUrl: "https://shop.myshopify.com/admin/oauth/authorize",
  tokenUrl: "https://shop.myshopify.com/admin/oauth/access_token",
  clientIdEnvVar: "SHOPIFY_CLIENT_ID",
  clientSecretEnvVar: "SHOPIFY_CLIENT_SECRET",
  apiBaseUrl: "https://shop.myshopify.com/admin/api/2024-01",
  defaultScopes: ["read_products", "write_products", "read_orders"],
  additionalAuthParams: {},
};

export const quickbooksConfig: OAuthServiceConfig = {
  providerId: "quickbooks",
  serviceId: "quickbooks",
  displayName: "QuickBooks",
  authorizationUrl: "https://appcenter.intuit.com/connect/oauth2",
  tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  clientIdEnvVar: "QUICKBOOKS_CLIENT_ID",
  clientSecretEnvVar: "QUICKBOOKS_CLIENT_SECRET",
  apiBaseUrl: "https://quickbooks.api.intuit.com/v3",
  defaultScopes: ["com.intuit.quickbooks.accounting"],
  additionalAuthParams: {},
};

export const xeroConfig: OAuthServiceConfig = {
  providerId: "xero",
  serviceId: "xero",
  displayName: "Xero",
  authorizationUrl: "https://login.xero.com/identity/connect/authorize",
  tokenUrl: "https://identity.xero.com/connect/token",
  clientIdEnvVar: "XERO_CLIENT_ID",
  clientSecretEnvVar: "XERO_CLIENT_SECRET",
  apiBaseUrl: "https://api.xero.com/api.xro/2.0",
  defaultScopes: ["openid", "profile", "email", "accounting.transactions", "offline_access"],
  additionalAuthParams: {},
};

export const boxConfig: OAuthServiceConfig = {
  providerId: "box",
  serviceId: "box",
  displayName: "Box",
  authorizationUrl: "https://account.box.com/api/oauth2/authorize",
  tokenUrl: "https://api.box.com/oauth2/token",
  clientIdEnvVar: "BOX_CLIENT_ID",
  clientSecretEnvVar: "BOX_CLIENT_SECRET",
  apiBaseUrl: "https://api.box.com/2.0",
  defaultScopes: [],
  additionalAuthParams: {},
};

export const webexConfig: OAuthServiceConfig = {
  providerId: "webex",
  serviceId: "webex",
  displayName: "Webex",
  authorizationUrl: "https://webexapis.com/v1/authorize",
  tokenUrl: "https://webexapis.com/v1/access_token",
  clientIdEnvVar: "WEBEX_CLIENT_ID",
  clientSecretEnvVar: "WEBEX_CLIENT_SECRET",
  apiBaseUrl: "https://webexapis.com/v1",
  defaultScopes: ["spark:all", "spark:kms"],
  additionalAuthParams: {},
};

export const trelloConfig: OAuthServiceConfig = {
  providerId: "trello",
  serviceId: "trello",
  displayName: "Trello",
  authorizationUrl: "https://trello.com/1/authorize",
  tokenUrl: "https://trello.com/1/OAuthGetAccessToken",
  clientIdEnvVar: "TRELLO_CLIENT_ID",
  clientSecretEnvVar: "TRELLO_CLIENT_SECRET",
  apiBaseUrl: "https://api.trello.com/1",
  defaultScopes: ["read", "write"],
  additionalAuthParams: {
    expiration: "never",
  },
};

export const clickupConfig: OAuthServiceConfig = {
  providerId: "clickup",
  serviceId: "clickup",
  displayName: "ClickUp",
  authorizationUrl: "https://app.clickup.com/api",
  tokenUrl: "https://api.clickup.com/api/v2/oauth/token",
  clientIdEnvVar: "CLICKUP_CLIENT_ID",
  clientSecretEnvVar: "CLICKUP_CLIENT_SECRET",
  apiBaseUrl: "https://api.clickup.com/api/v2",
  defaultScopes: [],
  additionalAuthParams: {},
};

export const pipedriveConfig: OAuthServiceConfig = {
  providerId: "pipedrive",
  serviceId: "pipedrive",
  displayName: "Pipedrive",
  authorizationUrl: "https://oauth.pipedrive.com/oauth/authorize",
  tokenUrl: "https://oauth.pipedrive.com/oauth/token",
  clientIdEnvVar: "PIPEDRIVE_CLIENT_ID",
  clientSecretEnvVar: "PIPEDRIVE_CLIENT_SECRET",
  apiBaseUrl: "https://api.pipedrive.com/v1",
  defaultScopes: [],
  additionalAuthParams: {},
};

export const commonServices = {
  github: githubConfig,
  slack: slackConfig,
  notion: notionConfig,
  figma: figmaConfig,
  discord: discordConfig,
  linear: linearConfig,
  gitlab: gitlabConfig,
  airtable: airtableConfig,
  dropbox: dropboxConfig,
  hubspot: hubspotConfig,
  salesforce: salesforceConfig,
  twitter: twitterConfig,
  asana: asanaConfig,
  monday: mondayConfig,
  zoom: zoomConfig,
  intercom: intercomConfig,
  freshdesk: freshdeskConfig,
  mailchimp: mailchimpConfig,
  shopify: shopifyConfig,
  quickbooks: quickbooksConfig,
  xero: xeroConfig,
  box: boxConfig,
  webex: webexConfig,
  trello: trelloConfig,
  clickup: clickupConfig,
  pipedrive: pipedriveConfig,
};
