import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
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
      for (const key of envKeys) {
        try {
          deleteEnv(key);
        } catch {
          // ignore
        }
      }

      assertEquals(providerRegistry.hasProvider("anthropic"), false);
    });

    it("picks up project-scoped env vars from AsyncLocalStorage", () => {
      // No host env key set
      assertEquals(providerRegistry.hasProvider("anthropic"), false);

      // Simulate per-request project env overlay.
      // Inside the overlay, auto-initialization should pick up the project-scoped key.
      // Note: In production, runWithContext also sets up project scope in the registry
      // so providers are properly isolated per-project. Here we only test env resolution.
      runWithProjectEnv({ ANTHROPIC_API_KEY: "sk-ant-project-key" }, () => {
        assertEquals(providerRegistry.hasProvider("anthropic"), true);
      });
    });
  });
});
