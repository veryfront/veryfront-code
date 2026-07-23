import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { OAuthServiceConfigSchema } from "../schemas/oauth.schema.ts";
import type { OAuthServiceConfig } from "../types.ts";
import { bitbucketConfig, confluenceConfig, jiraConfig } from "./atlassian.ts";
import {
  airtableConfig,
  asanaConfig,
  boxConfig,
  clickupConfig,
  figmaConfig,
  freshdeskConfig,
  githubConfig,
  gitlabConfig,
  hubspotConfig,
  intercomConfig,
  linearConfig,
  mailchimpConfig,
  mondayConfig,
  notionConfig,
  pipedriveConfig,
  quickbooksConfig,
  salesforceConfig,
  shopifyConfig,
  slackConfig,
  trelloConfig,
  twitterConfig,
  webexConfig,
  xeroConfig,
  zoomConfig,
} from "./common.ts";
import { calendarConfig, driveConfig, gmailConfig, sheetsConfig } from "./google.ts";
import { oneDriveConfig, outlookConfig, sharePointConfig, teamsConfig } from "./microsoft.ts";

const connectorBackedConfigs: Record<string, OAuthServiceConfig> = {
  airtable: airtableConfig,
  asana: asanaConfig,
  bitbucket: bitbucketConfig,
  box: boxConfig,
  calendar: calendarConfig,
  clickup: clickupConfig,
  confluence: confluenceConfig,
  drive: driveConfig,
  figma: figmaConfig,
  github: githubConfig,
  gitlab: gitlabConfig,
  gmail: gmailConfig,
  hubspot: hubspotConfig,
  intercom: intercomConfig,
  jira: jiraConfig,
  linear: linearConfig,
  mailchimp: mailchimpConfig,
  monday: mondayConfig,
  notion: notionConfig,
  onedrive: oneDriveConfig,
  outlook: outlookConfig,
  pipedrive: pipedriveConfig,
  quickbooks: quickbooksConfig,
  salesforce: salesforceConfig,
  sharepoint: sharePointConfig,
  sheets: sheetsConfig,
  shopify: shopifyConfig,
  slack: slackConfig,
  teams: teamsConfig,
  trello: trelloConfig,
  webex: webexConfig,
  xero: xeroConfig,
  zoom: zoomConfig,
};

const exportedConfigs: Record<string, OAuthServiceConfig> = {
  ...connectorBackedConfigs,
  freshdesk: freshdeskConfig,
  twitter: twitterConfig,
};

interface ConnectorAuth {
  type: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
}

describe("OAuth provider catalog", () => {
  for (const [name, config] of Object.entries(connectorBackedConfigs)) {
    it(`keeps ${name} authorization metadata aligned with its connector`, async () => {
      const connector = JSON.parse(
        await Deno.readTextFile(`cli/templates/integrations/${name}/connector.json`),
      ) as { auth: ConnectorAuth };

      assertEquals(connector.auth.type, "oauth2");
      assertEquals(config.serviceId, name);
      assertEquals(config.authorizationUrl, connector.auth.authorizationUrl);
      assertEquals(config.tokenUrl, connector.auth.tokenUrl);
      assertEquals(config.defaultScopes, connector.auth.scopes ?? []);
      assertEquals(OAuthServiceConfigSchema.safeParse(config).success, true);
      assertEquals(Object.isFrozen(config), true);
      assertEquals(Object.isFrozen(config.defaultScopes), true);
    });
  }

  it("keeps every exported provider config valid, frozen, and uniquely keyed", () => {
    const serviceIds = Object.values(exportedConfigs).map((config) => config.serviceId);
    assertEquals(new Set(serviceIds).size, serviceIds.length);

    for (const [serviceId, config] of Object.entries(exportedConfigs)) {
      assertEquals(config.serviceId, serviceId);
      assertEquals(OAuthServiceConfigSchema.safeParse(config).success, true);
      assertEquals(Object.isFrozen(config), true);
      assertEquals(Object.isFrozen(config.defaultScopes), true);
    }
  });

  it("uses provider-required token request encodings", () => {
    assertEquals(figmaConfig.useBasicAuth, true);
    assertEquals(notionConfig.useBasicAuth, true);
    assertEquals(notionConfig.tokenRequestFormat, "json");
    assertEquals(jiraConfig.tokenRequestFormat, "json");
    assertEquals(confluenceConfig.tokenRequestFormat, "json");
    assertEquals(bitbucketConfig.providerId, "bitbucket");
    assertEquals(bitbucketConfig.useBasicAuth, true);
    assertEquals(bitbucketConfig.tokenRequestFormat, "form");
    assertEquals(pipedriveConfig.useBasicAuth, true);
    assertEquals(quickbooksConfig.useBasicAuth, true);
    assertEquals(xeroConfig.useBasicAuth, true);
  });
});
