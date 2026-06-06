import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { commonServices, hubspotConfig, slackConfig } from "./common.ts";

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

  it("keeps the Slack runtime scopes aligned with the connector surface", async () => {
    assertEquals(slackConfig.defaultScopes, await readSlackConnectorScopes());
    assertEquals(slackConfig.defaultScopes, SLACK_SETUP_SCOPES);
  });

  it("keeps the HubSpot runtime scopes aligned with the connector surface", async () => {
    assertEquals(hubspotConfig.defaultScopes, await readHubSpotConnectorScopes());
    assertEquals(await readHubSpotConnectorOptionalScopes(), [
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
