import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteHostSecret, setHostSecret } from "#veryfront/platform/compat/process/env.ts";
import { deleteEnv, setEnv } from "#veryfront/testing/deno-compat.ts";
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
      deleteEnv("VERYFRONT_API_TOKEN");
    } catch { /* ok */ }
    try {
      deleteEnv("VERYFRONT_PROJECT_SLUG");
    } catch { /* ok */ }
    resetTokenStorageAdapter();
  });

  describe("isTokenStorageConfigured", () => {
    it("should return false when env vars are not set", () => {
      try {
        deleteEnv("VERYFRONT_API_TOKEN");
      } catch { /* ok */ }
      try {
        deleteEnv("VERYFRONT_PROJECT_SLUG");
      } catch { /* ok */ }
      assertEquals(isTokenStorageConfigured(), false);
    });

    it("should return false when only API token is set", () => {
      setEnv("VERYFRONT_API_TOKEN", "test-token");
      try {
        deleteEnv("VERYFRONT_PROJECT_SLUG");
      } catch { /* ok */ }
      assertEquals(isTokenStorageConfigured(), false);
    });

    it("should return false when only project slug is set", () => {
      try {
        deleteEnv("VERYFRONT_API_TOKEN");
      } catch { /* ok */ }
      setEnv("VERYFRONT_PROJECT_SLUG", "test-project");
      assertEquals(isTokenStorageConfigured(), false);
    });

    it("should return true when both env vars are set", () => {
      setEnv("VERYFRONT_API_TOKEN", "test-token");
      setEnv("VERYFRONT_PROJECT_SLUG", "test-project");
      assertEquals(isTokenStorageConfigured(), true);
    });

    it("resolves a host-private login token like an exported one", () => {
      // A stored `veryfront login` token is registered host-privately instead
      // of being exported, so a CLI-authenticated linked session must still
      // select veryfront-api storage.
      try {
        deleteEnv("VERYFRONT_API_TOKEN");
      } catch { /* ok */ }
      setEnv("VERYFRONT_PROJECT_SLUG", "test-project");
      setHostSecret("VERYFRONT_API_TOKEN", "host-private-token");
      try {
        assertEquals(isTokenStorageConfigured(), true);
        assertEquals(getTokenStorageType(), "veryfront-api");
      } finally {
        deleteHostSecret("VERYFRONT_API_TOKEN");
      }
    });

    it("does not let a blank exported token shadow the host-private one", () => {
      setEnv("VERYFRONT_API_TOKEN", "   ");
      setEnv("VERYFRONT_PROJECT_SLUG", "test-project");
      setHostSecret("VERYFRONT_API_TOKEN", "host-private-token");
      try {
        assertEquals(isTokenStorageConfigured(), true);
      } finally {
        deleteHostSecret("VERYFRONT_API_TOKEN");
      }
    });
  });

  describe("getTokenStorageType", () => {
    it("should return 'memory' when not configured", () => {
      try {
        deleteEnv("VERYFRONT_API_TOKEN");
      } catch { /* ok */ }
      try {
        deleteEnv("VERYFRONT_PROJECT_SLUG");
      } catch { /* ok */ }
      assertEquals(getTokenStorageType(), "memory");
    });

    it("should return 'veryfront-api' when configured", () => {
      setEnv("VERYFRONT_API_TOKEN", "test-token");
      setEnv("VERYFRONT_PROJECT_SLUG", "test-project");
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
        deleteEnv("VERYFRONT_API_TOKEN");
      } catch { /* ok */ }
      try {
        deleteEnv("VERYFRONT_PROJECT_SLUG");
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

    it("should return same instance on multiple calls (singleton)", async () => {
      const adapter1 = await getTokenStorageAdapter();
      const adapter2 = await getTokenStorageAdapter();
      assertStrictEquals(
        adapter1,
        adapter2,
        "getTokenStorageAdapter must return the same adapter instance",
      );
    });

    it("coalesces concurrent singleton creation", async () => {
      const [adapter1, adapter2, adapter3] = await Promise.all([
        getTokenStorageAdapter(),
        getTokenStorageAdapter(),
        getTokenStorageAdapter(),
      ]);
      assertStrictEquals(
        adapter1,
        adapter2,
        "concurrent callers must share one adapter instance",
      );
      assertStrictEquals(
        adapter2,
        adapter3,
        "concurrent callers must share one adapter instance",
      );
    });

    it("prevents pending creation from republishing an adapter after reset", async () => {
      const pending = getTokenStorageAdapter();
      resetTokenStorageAdapter();

      await assertRejects(
        () => pending,
        Error,
        "invalidated",
      );

      const replacement = await getTokenStorageAdapter();
      assertStrictEquals(
        await getTokenStorageAdapter(),
        replacement,
        "the replacement adapter must be published as the singleton",
      );
    });

    it("should create new instance after reset", async () => {
      const adapter1 = await getTokenStorageAdapter();
      resetTokenStorageAdapter();
      const adapter2 = await getTokenStorageAdapter();
      assertExists(adapter1);
      assertExists(adapter2);
      assertNotStrictEquals(
        adapter1,
        adapter2,
        "resetTokenStorageAdapter must publish a new adapter instance",
      );
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
