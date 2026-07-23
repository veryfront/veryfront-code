import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  getTokenStorageAdapter,
  getTokenStorageType,
  isTokenStorageConfigured,
  resetTokenStorageAdapter,
} from "./integration.ts";

describe("platform/adapters/token/integration", () => {
  afterEach(() => {
    // Clean up any env vars we set
    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
    } catch { /* ok */ }
    try {
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
    } catch { /* ok */ }
    resetTokenStorageAdapter();
  });

  describe("isTokenStorageConfigured", () => {
    it("should return false when env vars are not set", () => {
      try {
        Deno.env.delete("VERYFRONT_API_TOKEN");
      } catch { /* ok */ }
      try {
        Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      } catch { /* ok */ }
      assertEquals(isTokenStorageConfigured(), false);
    });

    it("should return false when only API token is set", () => {
      Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
      try {
        Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      } catch { /* ok */ }
      assertEquals(isTokenStorageConfigured(), false);
    });

    it("should return false when only project slug is set", () => {
      try {
        Deno.env.delete("VERYFRONT_API_TOKEN");
      } catch { /* ok */ }
      Deno.env.set("VERYFRONT_PROJECT_SLUG", "test-project");
      assertEquals(isTokenStorageConfigured(), false);
    });

    it("should return true when both env vars are set", () => {
      Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
      Deno.env.set("VERYFRONT_PROJECT_SLUG", "test-project");
      assertEquals(isTokenStorageConfigured(), true);
    });
  });

  describe("getTokenStorageType", () => {
    it("should return 'memory' when not configured", () => {
      try {
        Deno.env.delete("VERYFRONT_API_TOKEN");
      } catch { /* ok */ }
      try {
        Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      } catch { /* ok */ }
      assertEquals(getTokenStorageType(), "memory");
    });

    it("should return 'veryfront-api' when configured", () => {
      Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
      Deno.env.set("VERYFRONT_PROJECT_SLUG", "test-project");
      assertEquals(getTokenStorageType(), "veryfront-api");
    });
  });

  describe("resetTokenStorageAdapter", () => {
    it("should not throw when called with no adapter set", () => {
      resetTokenStorageAdapter();
    });

    it("should be callable multiple times", () => {
      resetTokenStorageAdapter();
      resetTokenStorageAdapter();
    });
  });

  describe("getTokenStorageAdapter", () => {
    afterEach(() => {
      try {
        Deno.env.delete("VERYFRONT_API_TOKEN");
      } catch { /* ok */ }
      try {
        Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      } catch { /* ok */ }
      resetTokenStorageAdapter();
    });

    it("should return a memory adapter when no env vars set", async () => {
      const adapter = await getTokenStorageAdapter();
      assertExists(adapter);
      assertExists(adapter.get);
      assertExists(adapter.set);
      assertExists(adapter.delete);
    });

    it("rejects partial cloud configuration instead of silently using memory", async () => {
      Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");

      await assertRejects(
        () => getTokenStorageAdapter(),
        Error,
        "requires both VERYFRONT_API_TOKEN and VERYFRONT_PROJECT_SLUG",
      );
    });

    it("should return same instance on multiple calls (singleton)", async () => {
      const adapter1 = await getTokenStorageAdapter();
      const adapter2 = await getTokenStorageAdapter();
      assertStrictEquals(adapter1, adapter2);
    });

    it("coalesces concurrent initialization into one singleton", async () => {
      const [adapter1, adapter2, adapter3] = await Promise.all([
        getTokenStorageAdapter(),
        getTokenStorageAdapter(),
        getTokenStorageAdapter(),
      ]);

      assertStrictEquals(adapter1, adapter2);
      assertStrictEquals(adapter2, adapter3);
    });

    it("should create new instance after reset", async () => {
      const adapter1 = await getTokenStorageAdapter();
      resetTokenStorageAdapter();
      const adapter2 = await getTokenStorageAdapter();
      assertExists(adapter1);
      assertExists(adapter2);
      assertNotStrictEquals(adapter1, adapter2);
    });

    it("does not let an in-flight initializer undo reset", async () => {
      const staleInitialization = getTokenStorageAdapter();
      resetTokenStorageAdapter();

      await assertRejects(
        () => staleInitialization,
        Error,
        "initialization was reset",
      );

      const current = await getTokenStorageAdapter();
      assertNotStrictEquals(await staleInitialization.catch(() => undefined), current);
    });

    it("should return a working memory adapter", async () => {
      const adapter = await getTokenStorageAdapter();
      await adapter.set("test-key", "test-value");
      assertEquals(await adapter.get("test-key"), "test-value");
      await adapter.delete("test-key");
      assertEquals(await adapter.get("test-key"), null);
    });
  });
});
