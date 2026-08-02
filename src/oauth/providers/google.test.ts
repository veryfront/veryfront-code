import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  calendarConfig,
  docsGoogleConfig,
  driveConfig,
  gmailConfig,
  googleServices,
  sheetsConfig,
} from "./google.ts";
import { docsGoogleConfig as exportedDocsGoogleConfig } from "./index.ts";

describe("Google OAuth provider configs", () => {
  it("exposes a dedicated Google Docs service contract", () => {
    assertEquals(exportedDocsGoogleConfig, docsGoogleConfig);
    assertEquals(googleServices["docs-google"], docsGoogleConfig);
    assertEquals(docsGoogleConfig.serviceId, "docs-google");
    assertEquals(docsGoogleConfig.apiBaseUrl, "https://docs.googleapis.com/v1");
    assertEquals(docsGoogleConfig.defaultScopes, [
      "https://www.googleapis.com/auth/documents.readonly",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive.readonly",
    ]);
  });

  it("keeps Google Docs runtime scopes aligned with the generated connector", async () => {
    const connector = JSON.parse(
      await Deno.readTextFile("cli/templates/integrations/docs-google/connector.json"),
    ) as { auth: { scopes: string[] } };
    assertEquals(docsGoogleConfig.defaultScopes, connector.auth.scopes);
  });

  it("keeps every Google runtime scope set aligned with its connector", async () => {
    for (
      const config of [gmailConfig, calendarConfig, sheetsConfig, driveConfig, docsGoogleConfig]
    ) {
      const connector = JSON.parse(
        await Deno.readTextFile(
          `cli/templates/integrations/${config.serviceId}/connector.json`,
        ),
      ) as { auth: { scopes: string[] } };
      assertEquals(config.defaultScopes, connector.auth.scopes);
    }
  });
});
