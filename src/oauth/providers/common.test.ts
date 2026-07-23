import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  airtableConfig,
  boxConfig,
  clickupConfig,
  commonServices,
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
import { bitbucketConfig } from "./atlassian.ts";
import { OAuthService } from "./base.ts";

const SLACK_SETUP_SCOPES = [
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
];

async function readSlackConnectorScopes(): Promise<string[]> {
  const connector = JSON.parse(
    await Deno.readTextFile("cli/templates/integrations/slack/connector.json"),
  ) as { auth: { scopes: string[] } };
  return connector.auth.scopes;
}

async function readConnectorScopes(name: string): Promise<string[]> {
  const connector = JSON.parse(
    await Deno.readTextFile(`cli/templates/integrations/${name}/connector.json`),
  ) as { auth: { scopes: string[] } };
  return connector.auth.scopes;
}

async function readHubSpotConnectorScopes(): Promise<string[]> {
  const connector = JSON.parse(
    await Deno.readTextFile("cli/templates/integrations/hubspot/connector.json"),
  ) as { auth: { scopes: string[] } };
  return connector.auth.scopes;
}

async function readHubSpotConnectorOptionalScopes(): Promise<string[]> {
  const connector = JSON.parse(
    await Deno.readTextFile("cli/templates/integrations/hubspot/connector.json"),
  ) as { auth: { optionalScopes: string[] } };
  return connector.auth.optionalScopes;
}

describe("oauth provider configs", () => {
  it("does not expose removed Discord or Dropbox OAuth provider configs", () => {
    assertEquals("discord" in commonServices, false);
    assertEquals("dropbox" in commonServices, false);
  });

  it("exposes supported CRM OAuth provider configs and hides feature-gated ones by default", () => {
    assertEquals("hubspot" in commonServices, true);
    assertEquals("salesforce" in commonServices, false);
  });

  it("fails closed when a provider needs a protocol- or tenant-specific adapter", () => {
    for (
      const config of [
        boxConfig,
        clickupConfig,
        freshdeskConfig,
        intercomConfig,
        mailchimpConfig,
        mondayConfig,
        pipedriveConfig,
        quickbooksConfig,
        salesforceConfig,
        shopifyConfig,
        trelloConfig,
        xeroConfig,
      ]
    ) {
      assertEquals(config.runtimeSupport, "provider-adapter-required");
      let rejected = false;
      try {
        new OAuthService(config, undefined, () => "configured");
      } catch (error) {
        rejected = error instanceof Error && error.message.includes("provider-specific adapter");
      }
      assertEquals(rejected, true, `${config.serviceId} must fail before a generic flow starts`);
    }
  });

  it("keeps the Slack runtime scopes aligned with the connector surface", async () => {
    assertEquals(slackConfig.defaultScopes, await readSlackConnectorScopes());
    assertEquals(slackConfig.defaultScopes, SLACK_SETUP_SCOPES);
  });

  it("declares provider-specific OAuth wire protocols", () => {
    assertEquals(slackConfig.scopeSeparator, ",");
    assertEquals(slackConfig.useBasicAuth, true);
    assertEquals(linearConfig.scopeSeparator, ",");

    assertEquals(notionConfig.tokenRequestFormat, "json");
    assertEquals(notionConfig.useBasicAuth, true);
    assertEquals(notionConfig.tokenRequestHeaders?.["Notion-Version"], "2026-03-11");
    assertEquals(notionConfig.apiHeaders?.["Notion-Version"], "2026-03-11");

    assertEquals(figmaConfig.tokenUrl, "https://api.figma.com/v1/oauth/token");
    assertEquals(figmaConfig.useBasicAuth, true);
    assertEquals(figmaConfig.pkceMode, "supported");
    assertEquals(airtableConfig.pkceMode, "required");
    assertEquals(hubspotConfig.tokenUrl, "https://api.hubapi.com/oauth/v3/token");
    assertEquals(hubspotConfig.pkceMode, "unsupported");
    assertEquals(bitbucketConfig.useBasicAuth, true);
    assertEquals(quickbooksConfig.useBasicAuth, true);
    assertEquals(xeroConfig.useBasicAuth, true);
    assertEquals(twitterConfig.authorizationUrl, "https://x.com/i/oauth2/authorize");
    assertEquals(twitterConfig.tokenUrl, "https://api.x.com/2/oauth2/token");
    assertEquals(twitterConfig.apiBaseUrl, "https://api.x.com/2");
    assertEquals(twitterConfig.pkceMode, "required");
    assertEquals(webexConfig.pkceMode, "supported");
    assertEquals(zoomConfig.pkceMode, "supported");
  });

  it("keeps common-provider runtime scopes aligned with connector surfaces", async () => {
    for (
      const config of [
        githubConfig,
        gitlabConfig,
        slackConfig,
        hubspotConfig,
        webexConfig,
        zoomConfig,
      ]
    ) {
      assertEquals(config.defaultScopes, await readConnectorScopes(config.serviceId));
    }
  });

  it("keeps the HubSpot runtime scopes aligned with the connector surface", async () => {
    assertEquals(hubspotConfig.defaultScopes, await readHubSpotConnectorScopes());
    assertEquals(await readHubSpotConnectorOptionalScopes(), [
      "forms",
      "crm.objects.leads.read",
      "crm.objects.leads.write",
    ]);
  });

  it("keeps Slack setup documentation aligned with runtime OAuth scopes", async () => {
    const setupMarkdown = await Deno.readTextFile(
      "cli/templates/integrations/_base/files/SETUP.md",
    );
    const setupHelpers = await Deno.readTextFile(
      "cli/templates/integrations/_base/files/app/setup/page-helpers.tsx",
    );

    for (const scope of slackConfig.defaultScopes) {
      assertEquals(setupMarkdown.includes(scope), true, `${scope} missing from SETUP.md`);
      assertEquals(setupHelpers.includes(scope), true, `${scope} missing from setup helper`);
    }
  });
});
