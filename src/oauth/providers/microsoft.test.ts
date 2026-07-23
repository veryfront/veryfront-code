import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { oneDriveConfig, outlookConfig, sharePointConfig, teamsConfig } from "./microsoft.ts";

describe("Microsoft OAuth provider configs", () => {
  it("keeps every runtime scope set aligned with its connector", async () => {
    for (const config of [outlookConfig, teamsConfig, sharePointConfig, oneDriveConfig]) {
      const connector = JSON.parse(
        await Deno.readTextFile(
          `cli/templates/integrations/${config.serviceId}/connector.json`,
        ),
      ) as { auth: { scopes: string[] } };
      assertEquals(config.defaultScopes, connector.auth.scopes);
    }
  });
});
