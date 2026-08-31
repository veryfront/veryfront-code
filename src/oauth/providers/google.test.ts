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
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive.readonly",
    ]);
  });

  it("keeps Google Docs runtime scopes aligned with the generated connector", async () => {
    const connector = JSON.parse(
      await Deno.readTextFile("templates/integrations/docs-google/connector.json"),
    ) as { auth: { scopes: string[] } };
    assertEquals(docsGoogleConfig.defaultScopes, connector.auth.scopes);
  });

  it("keeps every Google runtime scope set aligned with its connector", async () => {
    for (
      const config of [gmailConfig, calendarConfig, sheetsConfig, driveConfig, docsGoogleConfig]
    ) {
      const connector = JSON.parse(
        await Deno.readTextFile(
          `templates/integrations/${config.serviceId}/connector.json`,
        ),
      ) as { auth: { authorizationUrl: string; scopes: string[]; tokenUrl: string } };
      assertEquals(config.defaultScopes, connector.auth.scopes);
      assertEquals(
        config.authorizationUrl,
        connector.auth.authorizationUrl,
        `${config.serviceId} must authorize at the endpoint its connector advertises`,
      );
      assertEquals(
        config.tokenUrl,
        connector.auth.tokenUrl,
        `${config.serviceId} must exchange codes at the endpoint its connector advertises`,
      );
    }
  });

  it("pins the shared Google authorization contract for every service", () => {
    for (
      const config of [gmailConfig, calendarConfig, sheetsConfig, driveConfig, docsGoogleConfig]
    ) {
      assertEquals(
        config.additionalAuthParams,
        { access_type: "offline", prompt: "consent" },
        `${config.serviceId} must request offline access with a forced consent screen`,
      );
      assertEquals(
        config.pkceMode,
        "supported",
        `${config.serviceId} must keep PKCE enabled`,
      );
      assertEquals(
        config.authorizationUrl,
        "https://accounts.google.com/o/oauth2/v2/auth",
        `${config.serviceId} must use the Google authorization endpoint`,
      );
      assertEquals(
        config.tokenUrl,
        "https://oauth2.googleapis.com/token",
        `${config.serviceId} must use the Google token endpoint`,
      );
      assertEquals(
        config.clientIdEnvVar,
        "GOOGLE_CLIENT_ID",
        `${config.serviceId} must read the shared Google client id`,
      );
      assertEquals(
        config.clientSecretEnvVar,
        "GOOGLE_CLIENT_SECRET",
        `${config.serviceId} must read the shared Google client secret`,
      );
    }
  });
});
