import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateAIConfig } from "./config-validator.ts";
import type { VeryfrontConfig } from "#veryfront/config/types.ts";

describe("cli/discovery/config-validator", () => {
  describe("validateAIConfig", () => {
    it("should return valid with no providers configured", () => {
      const config = {} as VeryfrontConfig;
      const result = validateAIConfig(config);

      assertEquals(result.valid, true);
      assertEquals(result.warnings.length, 0);
      assertEquals(result.errors.length, 0);
    });

    it("should return valid when ai config is undefined", () => {
      const config = { ai: undefined } as VeryfrontConfig;
      const result = validateAIConfig(config);

      assertEquals(result.valid, true);
    });

    it("should return valid when ai.providers is undefined", () => {
      const config = { ai: {} } as VeryfrontConfig;
      const result = validateAIConfig(config);

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
      const result = validateAIConfig(config);

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
      const result = validateAIConfig(config);

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
      const result = validateAIConfig(config);

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
      const result = validateAIConfig(config);

      assertEquals(result.warnings[0]?.includes("ANTHROPIC_API_KEY"), true);
    });
  });
});
