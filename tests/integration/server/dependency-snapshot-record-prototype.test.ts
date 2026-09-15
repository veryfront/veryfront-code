import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createCacheBackedDependencySnapshotStore } from "#veryfront/cache/dependency-snapshot-store.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";

describe("snapshot record own fields", () => {
  for (const mode of ["read", "publish"] as const) {
    it(`rejects inherited fields during ${mode}`, async () => {
      let writes = 0;
      const backend: CacheBackend = {
        type: "memory",
        get: () => Promise.resolve(mode === "publish" && writes === 0 ? null : "{}"),
        set: () => {
          writes++;
          return Promise.resolve();
        },
        del: () => Promise.resolve(),
      };
      const store = createCacheBackedDependencySnapshotStore(() => Promise.resolve(backend));
      const value = Object.getOwnPropertyDescriptor(Object.prototype, "value");
      const expiry = Object.getOwnPropertyDescriptor(Object.prototype, "expiresAt");
      const expiresAt = Date.now() + 60_000;
      let rejected = false;
      try {
        const valueDescriptor = {
          __proto__: null,
          configurable: true,
          writable: true,
          value: "synthetic-snapshot",
        };
        Object.defineProperty(Object.prototype, "value", valueDescriptor);
        const expiryDescriptor = {
          __proto__: null,
          configurable: true,
          writable: true,
          value: expiresAt,
        };
        Object.defineProperty(Object.prototype, "expiresAt", expiryDescriptor);
        try {
          if (mode === "read") await store.read("synthetic-namespace", "synthetic-key");
          else {await store.publish(
              "synthetic-namespace",
              "synthetic-key",
              "synthetic-snapshot",
              expiresAt,
            );}
        } catch {
          rejected = true;
        }
      } finally {
        if (value) Object.defineProperty(Object.prototype, "value", value);
        else Reflect.deleteProperty(Object.prototype, "value");
        if (expiry) Object.defineProperty(Object.prototype, "expiresAt", expiry);
        else Reflect.deleteProperty(Object.prototype, "expiresAt");
      }
      assertEquals(rejected, true);
      assertEquals(writes, mode === "publish" ? 1 : 0);
    });
  }
});
