import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#std/path.ts";
import { generateIntegration, type IntegrationGeneratorOptions } from "./integration-generator.ts";
import {
  getNonInteractiveConfig,
  getToolExecuteBody,
  getToolInputSchema,
  parseScopes,
  validateIntegrationName,
} from "./integration-generator-helpers.ts";

describe("cli/commands/generate/integration-generator", () => {
  describe("IntegrationGeneratorOptions type", () => {
    it("should accept empty options", () => {
      const options: IntegrationGeneratorOptions = {};
      assertEquals(Object.keys(options).length, 0);
    });

    it("should accept full options", () => {
      const options: IntegrationGeneratorOptions = {
        name: "twilio",
        displayName: "Twilio",
        authType: "oauth2",
        apiBaseUrl: "https://api.twilio.com",
        authorizationUrl: "https://twilio.com/oauth/authorize",
        tokenUrl: "https://twilio.com/oauth/token",
        scopes: "messages:read,messages:write",
        tokenAuthMethod: "client_secret_basic",
        additionalAuthParams: "access_type=offline,prompt=consent",
        usePKCE: true,
        skipPrompts: true,
      };

      assertEquals(options.name, "twilio");
      assertEquals(options.authType, "oauth2");
      assertEquals(options.skipPrompts, true);
      assertEquals(options.usePKCE, true);
    });

    it("should accept api-key auth type", () => {
      const options: IntegrationGeneratorOptions = {
        name: "sendgrid",
        displayName: "SendGrid",
        authType: "api-key",
        skipPrompts: true,
      };

      assertEquals(options.authType, "api-key");
    });
  });

  describe("integration name validation pattern", () => {
    function assertThrows(fn: () => void): void {
      let threw = false;
      try {
        fn();
      } catch {
        threw = true;
      }
      assertEquals(threw, true);
    }

    it("should accept valid lowercase name", () => {
      validateIntegrationName("twilio");
    });

    it("should accept name with hyphens", () => {
      validateIntegrationName("my-integration");
    });

    it("should accept name with numbers", () => {
      validateIntegrationName("api2go");
    });

    it("should reject uppercase", () => {
      assertThrows(() => validateIntegrationName("Twilio"));
    });

    it("should reject empty string", () => {
      assertThrows(() => validateIntegrationName(""));
    });

    it("should reject name starting with number", () => {
      assertThrows(() => validateIntegrationName("2fast"));
    });

    it("should reject name starting with hyphen", () => {
      assertThrows(() => validateIntegrationName("-invalid"));
    });

    it("should reject name with spaces", () => {
      assertThrows(() => validateIntegrationName("my integration"));
    });

    it("should reject name with special characters", () => {
      assertThrows(() => validateIntegrationName("my_integration"));
    });
  });

  describe("scope parsing pattern", () => {
    it("should parse comma-separated scopes", () => {
      assertEquals(parseScopes("read,write"), ["read", "write"]);
    });

    it("should trim whitespace", () => {
      assertEquals(parseScopes(" read , write "), ["read", "write"]);
    });

    it("should return empty array for undefined", () => {
      assertEquals(parseScopes(undefined), []);
    });

    it("should handle single scope", () => {
      assertEquals(parseScopes("admin"), ["admin"]);
    });

    it("should handle complex scope names", () => {
      assertEquals(
        parseScopes("messages:read,messages:write,users.profile"),
        ["messages:read", "messages:write", "users.profile"],
      );
    });

    it("should handle empty string", () => {
      assertEquals(parseScopes(""), [""]);
    });
  });

  describe("non-interactive config construction pattern", () => {
    function assertThrows(fn: () => void): void {
      let threw = false;
      try {
        fn();
      } catch {
        threw = true;
      }
      assertEquals(threw, true);
    }

    it("should build config with all fields", () => {
      const config = getNonInteractiveConfig({
        name: "twilio",
        displayName: "Twilio",
        authType: "oauth2",
        apiBaseUrl: "https://api.twilio.com",
        authorizationUrl: "https://twilio.com/oauth/authorize",
        tokenUrl: "https://twilio.com/oauth/token",
        scopes: "messages:read,messages:write",
        tokenAuthMethod: "basic",
        additionalAuthParams: "access_type=offline,prompt=consent",
        usePKCE: true,
        skipPrompts: true,
      });

      assertEquals(config.name, "twilio");
      assertEquals(config.displayName, "Twilio");
      assertEquals(config.authType, "oauth2");
      assertEquals(config.apiBaseUrl, "https://api.twilio.com");
      assertEquals(config.envVarPrefix, "TWILIO");
      assertEquals(config.scopes.length, 2);
      assertEquals(config.tokenAuthMethod, "basic");
      assertEquals(config.additionalAuthParams, { access_type: "offline", prompt: "consent" });
      assertEquals(config.usePKCE, true);
    });

    it("should default apiBaseUrl from name", () => {
      const config = getNonInteractiveConfig({
        name: "zendesk",
        displayName: "Zendesk",
        authType: "api-key",
      });
      assertEquals(config.apiBaseUrl, "https://api.zendesk.com");
    });

    it("should lowercase name", () => {
      const config = getNonInteractiveConfig({
        name: "MyService",
        displayName: "MyService",
        authType: "api-key",
      });
      assertEquals(config.name, "myservice");
    });

    it("should uppercase env var prefix", () => {
      const config = getNonInteractiveConfig({
        name: "my-api",
        displayName: "My API",
        authType: "api-key",
      });
      assertEquals(config.envVarPrefix, "MY_API");
    });

    it("should throw when name is missing", () => {
      assertThrows(() =>
        getNonInteractiveConfig({
          displayName: "Test",
          authType: "api-key",
        })
      );
    });

    it("should throw when displayName is missing", () => {
      assertThrows(() =>
        getNonInteractiveConfig({
          name: "test",
          authType: "api-key",
        })
      );
    });

    it("should throw when authType is missing", () => {
      assertThrows(() =>
        getNonInteractiveConfig({
          name: "test",
          displayName: "Test",
        })
      );
    });

    it("should default scopes to empty array", () => {
      const config = getNonInteractiveConfig({
        name: "test",
        displayName: "Test",
        authType: "api-key",
      });
      assertEquals(config.scopes, []);
    });
  });

  describe("generateIntegration", () => {
    it("generates OAuth scaffold with configurable auth method, extra auth params, and PKCE", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-integration-generator-" });

      try {
        await generateIntegration(projectDir, {
          name: "figma",
          displayName: "Figma",
          authType: "oauth2",
          apiBaseUrl: "https://api.figma.com/v1",
          authorizationUrl: "https://www.figma.com/oauth",
          tokenUrl: "https://api.figma.com/v1/oauth/token",
          scopes: "file_content:read",
          tokenAuthMethod: "client_secret_basic",
          additionalAuthParams: "access_type=offline,prompt=consent",
          usePKCE: true,
          skipPrompts: true,
        });

        const tokenStore = await Deno.readTextFile(
          join(projectDir, "ai", "integrations", "figma", "lib", "token-store.ts"),
        );
        const authRoute = await Deno.readTextFile(
          join(projectDir, "app", "api", "auth", "figma", "route.ts"),
        );
        const callbackRoute = await Deno.readTextFile(
          join(projectDir, "app", "api", "auth", "figma", "callback", "route.ts"),
        );

        assertStringIncludes(
          tokenStore,
          'const TOKEN_AUTH_METHOD: TokenAuthMethod = "client_secret_basic";',
        );
        assertStringIncludes(
          tokenStore,
          "headers.Authorization = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;",
        );
        assertStringIncludes(tokenStore, "clearTokens();");
        assertStringIncludes(
          authRoute,
          'const ADDITIONAL_AUTH_PARAMS = {\n  "access_type": "offline",\n  "prompt": "consent"\n};',
        );
        assertStringIncludes(authRoute, 'params.set("code_challenge", challenge);');
        assertStringIncludes(authRoute, 'const PKCE_COOKIE_NAME = "figma_pkce_verifier";');
        assertStringIncludes(
          callbackRoute,
          'codeVerifier = parseCookies(request.headers.get("cookie") ?? "")[PKCE_COOKIE_NAME];',
        );
        assertStringIncludes(
          callbackRoute,
          "await exchangeCodeForTokens(code, redirectUri, codeVerifier);",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  describe("tool input schema generation pattern", () => {
    it("should return list-items schema", () => {
      const schema = getToolInputSchema("list-items.ts");
      assertEquals(schema.includes("limit"), true);
      assertEquals(schema.includes("offset"), true);
    });

    it("should return get-item schema", () => {
      const schema = getToolInputSchema("get-item.ts");
      assertEquals(schema.includes("id"), true);
    });

    it("should return search schema", () => {
      const schema = getToolInputSchema("search.ts");
      assertEquals(schema.includes("query"), true);
    });

    it("should return empty string for unknown file", () => {
      assertEquals(getToolInputSchema("unknown.ts"), "");
    });
  });

  describe("tool execute body generation pattern", () => {
    it("should return list-items execute body", () => {
      const body = getToolExecuteBody("list-items.ts");
      assertEquals(body.includes("listItems"), true);
      assertEquals(body.includes("success: true"), true);
    });

    it("should return get-item execute body", () => {
      const body = getToolExecuteBody("get-item.ts");
      assertEquals(body.includes("getItem"), true);
    });

    it("should return search execute body", () => {
      const body = getToolExecuteBody("search.ts");
      assertEquals(body.includes("searchItems"), true);
    });

    it("should return empty string for unknown file", () => {
      assertEquals(getToolExecuteBody("unknown.ts"), "");
    });
  });
});
