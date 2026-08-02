import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { bitbucketConfig, confluenceConfig, jiraConfig } from "./atlassian.ts";

async function readConfluenceConnectorScopes(): Promise<string[]> {
  const connector = JSON.parse(
    await Deno.readTextFile("cli/templates/integrations/confluence/connector.json"),
  ) as { auth: { scopes: string[] } };
  return connector.auth.scopes;
}

describe("Atlassian OAuth provider configs", () => {
  it("keeps Confluence runtime scopes aligned with the connector surface", async () => {
    assertEquals(confluenceConfig.defaultScopes, await readConfluenceConnectorScopes());
  });

  it("uses Atlassian's JSON token protocol for Jira and Confluence", () => {
    assertEquals(jiraConfig.tokenRequestFormat, "json");
    assertEquals(confluenceConfig.tokenRequestFormat, "json");
  });

  it("declares the one shared callback accepted by the Atlassian OAuth app", async () => {
    for (const serviceId of ["jira", "confluence"]) {
      const connector = JSON.parse(
        await Deno.readTextFile(
          `cli/templates/integrations/${serviceId}/connector.json`,
        ),
      ) as {
        auth: {
          callbackPath?: string;
          tokenAuthMethod?: string;
          additionalParams?: Record<string, string>;
        };
      };
      assertEquals(
        connector.auth.callbackPath,
        "/api/auth/atlassian/callback",
      );
      assertEquals(connector.auth.tokenAuthMethod, "body");
      assertEquals(connector.auth.additionalParams, undefined);
    }
  });

  it("keeps every Atlassian runtime scope set aligned with its connector", async () => {
    for (const config of [jiraConfig, confluenceConfig, bitbucketConfig]) {
      const connector = JSON.parse(
        await Deno.readTextFile(
          `cli/templates/integrations/${config.serviceId}/connector.json`,
        ),
      ) as { auth: { scopes: string[] } };
      assertEquals(config.defaultScopes, connector.auth.scopes);
    }
  });
});
