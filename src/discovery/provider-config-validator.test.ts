import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { validateProviderConfig } from "./provider-config-validator.ts";

describe("src/discovery/provider-config-validator", () => {
  describe("validateProviderConfig", () => {
    it("should return valid with no providers configured", () => {
      const config = {} as VeryfrontConfig;
      const result = validateProviderConfig(config);

      assertEquals(result.valid, true);
      assertEquals(result.warnings.length, 0);
      assertEquals(result.errors.length, 0);
    });

    it("should return valid when ai config is undefined", () => {
      const config = { ai: undefined } as VeryfrontConfig;
      const result = validateProviderConfig(config);

      assertEquals(result.valid, true);
    });

    it("should return valid when ai.providers is undefined", () => {
      const config = { ai: {} } as VeryfrontConfig;
      const result = validateProviderConfig(config);

      assertEquals(result.valid, true);
      assertEquals(result.warnings.length, 0);
    });

    it("should warn when a provider has no apiKey", () => {
      const config = {
        ai: {
          providers: {
            openai: {},
          },
        },
      } as VeryfrontConfig;
      const result = validateProviderConfig(config);

      assertEquals(result.valid, true);
      assertEquals(result.warnings.length, 1);
      assertEquals(result.warnings[0]?.includes("openai"), true);
      assertEquals(result.warnings[0]?.includes("OPENAI_API_KEY"), true);
    });

    it("should not warn when provider has apiKey", () => {
      const config = {
        ai: {
          providers: {
            openai: { apiKey: "sk-test" },
          },
        },
      } as VeryfrontConfig;
      const result = validateProviderConfig(config);

      assertEquals(result.valid, true);
      assertEquals(result.warnings.length, 0);
    });

    it("should warn for each provider missing apiKey", () => {
      const config = {
        ai: {
          providers: {
            openai: {},
            anthropic: {},
            groq: { apiKey: "key-exists" },
          },
        },
      } as VeryfrontConfig;
      const result = validateProviderConfig(config);

      assertEquals(result.warnings.length, 2);
    });

    it("should generate correct env var name in warning", () => {
      const config = {
        ai: {
          providers: {
            anthropic: {},
          },
        },
      } as VeryfrontConfig;
      const result = validateProviderConfig(config);

      assertEquals(result.warnings[0]?.includes("ANTHROPIC_API_KEY"), true);
    });

    it("does not require API keys for built-in credential-free providers", () => {
      const config = {
        ai: {
          providers: {
            local: {},
            "veryfront-cloud": {},
          },
        },
      } as VeryfrontConfig;

      assertEquals(validateProviderConfig(config).warnings, []);
    });

    it("uses canonical Google credential names", () => {
      const config = {
        ai: { providers: { google: {} } },
      } as VeryfrontConfig;

      const warning = validateProviderConfig(config).warnings[0] ?? "";
      assertEquals(warning.includes("GOOGLE_API_KEY"), true);
      assertEquals(warning.includes("GOOGLE_GENERATIVE_AI_API_KEY"), true);
    });

    it("does not invent or reflect unsafe environment names for custom providers", () => {
      const config = {
        ai: { providers: { "custom\nprovider": {} } },
      } as VeryfrontConfig;

      const warning = validateProviderConfig(config).warnings[0] ?? "";
      assertEquals(warning.includes("\nprovider"), false);
      assertEquals(warning.includes("CUSTOM\nPROVIDER_API_KEY"), false);
      assertEquals(warning.includes("apiKey"), true);
    });

    it("treats object-prototype names as custom providers", () => {
      const config = {
        ai: { providers: { toString: {} } },
      } as unknown as VeryfrontConfig;

      const result = validateProviderConfig(config);

      assertEquals(result.valid, true);
      assertEquals(result.warnings.length, 1);
      assertEquals(result.warnings[0]?.includes("apiKey"), true);
    });

    it("returns bounded validation errors for malformed runtime input", () => {
      const malformed = validateProviderConfig(null as unknown as VeryfrontConfig);
      assertEquals(malformed.valid, false);
      assertEquals(malformed.errors, ["Provider configuration must be an object."]);

      const invalidEntry = validateProviderConfig({
        ai: { providers: { openai: null } },
      } as unknown as VeryfrontConfig);
      assertEquals(invalidEntry.valid, false);
      assertEquals(invalidEntry.errors.length, 1);
      assertEquals(invalidEntry.errors[0]?.includes("openai"), false);
    });

    it("does not expose provider getter failures", () => {
      const canary = "PRIVATE_PROVIDER_GETTER_CANARY";
      const provider = Object.defineProperty({}, "apiKey", {
        get() {
          throw new Error(canary);
        },
      });

      const result = validateProviderConfig({
        ai: { providers: { custom: provider } },
      } as VeryfrontConfig);

      assertEquals(result.valid, false);
      assertEquals(result.errors.some((message) => message.includes(canary)), false);
    });
  });
});
