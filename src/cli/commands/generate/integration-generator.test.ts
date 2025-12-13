import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import type { IntegrationGeneratorOptions } from "./integration-generator.ts";

describe("integration-generator", () => {
  describe("generateIntegration", () => {
    it("should export generateIntegration function", async () => {
      const module = await import("./integration-generator.ts");
      assertExists(module.generateIntegration);
      assertEquals(typeof module.generateIntegration, "function");
    });
  });

  describe("IntegrationGeneratorOptions interface", () => {
    it("should define the correct structure", () => {
      const options: IntegrationGeneratorOptions = {
        name: "test-integration",
        displayName: "Test Integration",
        authType: "oauth2",
        apiBaseUrl: "https://api.test.com",
        skipPrompts: true,
      };

      assertEquals(options.name, "test-integration");
      assertEquals(options.displayName, "Test Integration");
      assertEquals(options.authType, "oauth2");
      assertEquals(options.apiBaseUrl, "https://api.test.com");
      assertEquals(options.skipPrompts, true);
    });

    it("should support api-key auth type", () => {
      const options: IntegrationGeneratorOptions = {
        authType: "api-key",
      };

      assertEquals(options.authType, "api-key");
    });

    it("should support OAuth2 fields", () => {
      const options: IntegrationGeneratorOptions = {
        authorizationUrl: "https://test.com/oauth/authorize",
        tokenUrl: "https://test.com/oauth/token",
        scopes: "read,write",
      };

      assertEquals(options.authorizationUrl, "https://test.com/oauth/authorize");
      assertEquals(options.tokenUrl, "https://test.com/oauth/token");
      assertEquals(options.scopes, "read,write");
    });

    it("should allow all fields to be optional", () => {
      const options: IntegrationGeneratorOptions = {};

      assertEquals(Object.keys(options).length, 0);
    });
  });
});
