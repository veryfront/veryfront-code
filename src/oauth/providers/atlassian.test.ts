import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { confluenceConfig } from "./atlassian.ts";

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
});
