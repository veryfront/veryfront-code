import "#veryfront/schemas/_test-setup.ts";
import { createCacheBackedDependencySnapshotStore } from "#veryfront/cache/dependency-snapshot-store.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("dependency snapshot publication deadline", () => {
  for (const stage of ["accepted mutation", "retry", "retained winner"] as const) {
    it(`rejects when retention expires during ${stage}`, async () => {
      const expiresAt = Date.now() + 1_000;
      let attempts = 0;
      let reads = 0;
      const expire = async () => {
        while (Date.now() <= expiresAt) {
          await new Promise((resolve) => setTimeout(resolve, expiresAt - Date.now() + 1));
        }
      };
      const backend: CacheBackend = {
        type: "memory",
        get: () => Promise.resolve(null),
        set: () => Promise.reject(new Error("Unconditional publication is not allowed")),
        del: () => Promise.resolve(),
        getWithRevision: async () => {
          reads++;
          if (reads === 1) return { value: null, revision: "empty" };
          await expire();
          return {
            value: stage === "retained winner"
              ? JSON.stringify({ value: "snapshot-bytes", expiresAt })
              : null,
            revision: "winner",
          };
        },
        compareExchange: async () => {
          attempts++;
          if (stage === "accepted mutation") {
            await expire();
            // An expired CAS set succeeds but leaves the key absent.
            return true;
          }
          return attempts > 1;
        },
      };
      const store = createCacheBackedDependencySnapshotStore(() => Promise.resolve(backend));
      await assertRejects(
        () => store.publish("synthetic-namespace", "snapshot-key", "snapshot-bytes", expiresAt),
        Error,
        "retention window has already passed",
      );
      assertEquals(attempts, 1);
    });
  }
});
