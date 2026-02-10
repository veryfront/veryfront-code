import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { providerRegistry } from "./factory.ts";

describe("ProviderRegistry", () => {
  const envKeys = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
  ];

  afterEach(() => {
    providerRegistry.clearAll();
    for (const key of envKeys) {
      try {
        deleteEnv(key);
      } catch {
        // ignore
      }
    }
  });

  describe("autoInitializeFromEnv", () => {
    it("registers anthropic provider when ANTHROPIC_API_KEY is set", () => {
      setEnv("ANTHROPIC_API_KEY", "sk-ant-test-key");

      assertEquals(providerRegistry.hasProvider("anthropic"), true);
    });

    it("registers openai provider when OPENAI_API_KEY is set", () => {
      setEnv("OPENAI_API_KEY", "sk-test-openai-key");

      assertEquals(providerRegistry.hasProvider("openai"), true);
    });

    it("registers google provider when GOOGLE_API_KEY is set", () => {
      setEnv("GOOGLE_API_KEY", "test-google-key");

      assertEquals(providerRegistry.hasProvider("google"), true);
    });

    it("does not register provider when key is absent", () => {
      // Ensure no API keys are set
      for (const key of envKeys) {
        try {
          deleteEnv(key);
        } catch {
          // ignore
        }
      }

      assertEquals(providerRegistry.hasProvider("anthropic"), false);
    });

    it("reads live env vars, not cached config", () => {
      // First call: no key set
      assertEquals(providerRegistry.hasProvider("anthropic"), false);

      // Now set the key (simulating project env overlay)
      setEnv("ANTHROPIC_API_KEY", "sk-ant-test-key");

      // Should pick up the newly set key on next access
      assertEquals(providerRegistry.hasProvider("anthropic"), true);
    });
  });
});
