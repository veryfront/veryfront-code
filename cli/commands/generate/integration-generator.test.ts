import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { IntegrationGeneratorOptions } from "./integration-generator.ts";

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
        skipPrompts: true,
      };

      assertEquals(options.name, "twilio");
      assertEquals(options.authType, "oauth2");
      assertEquals(options.skipPrompts, true);
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
    function validateIntegrationName(name: string): void {
      if (name && /^[a-z][a-z0-9-]*$/.test(name)) return;

      throw new Error(
        "Integration name must be lowercase letters, numbers, and hyphens",
      );
    }

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
    function parseScopes(scopes?: string): string[] {
      return scopes?.split(",").map((s) => s.trim()) ?? [];
    }

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
    function getNonInteractiveConfig(options: IntegrationGeneratorOptions) {
      if (!options.name || !options.displayName || !options.authType) {
        throw new Error(
          "Non-interactive mode requires --name, --display-name, and --auth-type options",
        );
      }

      return {
        name: options.name.toLowerCase(),
        displayName: options.displayName,
        authType: options.authType,
        apiBaseUrl: options.apiBaseUrl ?? `https://api.${options.name}.com`,
        authorizationUrl: options.authorizationUrl,
        tokenUrl: options.tokenUrl,
        scopes: options.scopes?.split(",").map((s) => s.trim()) ?? [],
        envVarPrefix: options.name.toUpperCase(),
      };
    }

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
        skipPrompts: true,
      });

      assertEquals(config.name, "twilio");
      assertEquals(config.displayName, "Twilio");
      assertEquals(config.authType, "oauth2");
      assertEquals(config.apiBaseUrl, "https://api.twilio.com");
      assertEquals(config.envVarPrefix, "TWILIO");
      assertEquals(config.scopes.length, 2);
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
      assertEquals(config.envVarPrefix, "MY-API");
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

  describe("tool input schema generation pattern", () => {
    function getToolInputSchema(toolFile: string): string {
      switch (toolFile) {
        case "list-items.ts":
          return `limit: z.number().optional().describe("Maximum number of items to return"),
    offset: z.number().optional().describe("Number of items to skip"),`;
        case "get-item.ts":
          return `id: z.string().describe("The ID of the item to retrieve"),`;
        case "search.ts":
          return `query: z.string().describe("Search query"),`;
        default:
          return "";
      }
    }

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
    function getToolExecuteBody(toolFile: string): string {
      switch (toolFile) {
        case "list-items.ts":
          return `const items = await listItems({
        limit: input.limit,
        offset: input.offset,
      });
      return {
        success: true,
        items,
        count: items.length,
      };`;
        case "get-item.ts":
          return `const item = await getItem(input.id);
      return {
        success: true,
        item,
      };`;
        case "search.ts":
          return `const results = await searchItems(input.query);
      return {
        success: true,
        results,
        count: results.length,
      };`;
        default:
          return "";
      }
    }

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
