import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontTokenAdapter } from "./adapter.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";

describe("platform/adapters/token/veryfront/adapter", () => {
  function createConfig(overrides: Record<string, unknown> = {}) {
    return {
      type: "veryfront-api" as const,
      veryfront: {
        apiToken: "test-token",
        projectSlug: "test-project",
        apiBaseUrl: "http://localhost:9999",
        retry: { maxRetries: 0, initialDelay: 10, maxDelay: 50 },
        ...overrides,
      },
    };
  }

  describe("constructor", () => {
    it("should create adapter with valid config", () => {
      const adapter = new VeryfrontTokenAdapter(createConfig());
      assertEquals(typeof adapter, "object");
    });
  });

  describe("initialize", () => {
    it("should throw when API is unreachable", async () => {
      const adapter = new VeryfrontTokenAdapter(createConfig());
      await assertRejects(
        () => adapter.initialize(),
        VeryfrontError,
      );
    });
  });

  describe("dispose", () => {
    it("should not throw", () => {
      const adapter = new VeryfrontTokenAdapter(createConfig());
      adapter.dispose();
    });

    it("should allow re-initialization attempt after dispose", async () => {
      const adapter = new VeryfrontTokenAdapter(createConfig());
      adapter.dispose();
      // Should attempt to re-init (will fail since API is unreachable)
      await assertRejects(() => adapter.initialize(), VeryfrontError);
    });
  });
});
