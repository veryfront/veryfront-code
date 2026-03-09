import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it, afterEach } from "#veryfront/testing/bdd.ts";
import { ManifestHandler } from "./manifest-handler.ts";
import type { CacheRepository } from "#veryfront/repositories/types.ts";

function createMockCacheRepo(): CacheRepository<string> & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, _ttl?: number) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async has(key: string) {
      return store.has(key);
    },
  } as CacheRepository<string> & { store: Map<string, string> };
}

describe("server/services/rsc/orchestrators/manifest-handler", () => {
  describe("handle", () => {
    it("should return JSON response with components map", async () => {
      const manifest = new Map([
        ["Button", { path: "/app/components/Button.tsx", exports: [] }],
        ["Card", { path: "/app/components/Card.tsx", exports: [] }],
      ]);

      const handler = new ManifestHandler("/project");
      const response = await handler.handle(manifest as any);

      assertEquals(response.headers.get("content-type"), "application/json");
      const body = await response.json();
      assertEquals(body.components.Button, "/app/components/Button.tsx");
      assertEquals(body.components.Card, "/app/components/Card.tsx");
    });

    it("should return empty components for empty manifest", async () => {
      const handler = new ManifestHandler("/project");
      const response = await handler.handle(new Map());
      const body = await response.json();
      assertEquals(body.components, {});
    });

    it("should cache result on second call (in-memory)", async () => {
      const manifest = new Map([
        ["A", { path: "/a.tsx", exports: [] }],
      ]);

      const handler = new ManifestHandler("/project");
      const response1 = await handler.handle(manifest as any);
      const body1 = await response1.json();

      // Second call with different manifest should return cached data
      const manifest2 = new Map([
        ["B", { path: "/b.tsx", exports: [] }],
      ]);
      const response2 = await handler.handle(manifest2 as any);
      const body2 = await response2.json();

      assertEquals(body1.components.A, body2.components.A);
      assertEquals(body2.components.B, undefined);
    });
  });

  describe("handle with injected CacheRepository", () => {
    it("should use injected cache repo for caching", async () => {
      const cacheRepo = createMockCacheRepo();
      const manifest = new Map([
        ["X", { path: "/x.tsx", exports: [] }],
      ]);

      const handler = new ManifestHandler("/project", { cacheRepo });
      await handler.handle(manifest as any);

      assertEquals(cacheRepo.store.size, 1);
    });

    it("should return cached data from injected cache", async () => {
      const cacheRepo = createMockCacheRepo();
      const manifest = new Map([
        ["Y", { path: "/y.tsx", exports: [] }],
      ]);

      const handler = new ManifestHandler("/project", { cacheRepo });
      await handler.handle(manifest as any);

      // Second call should use cache
      const response = await handler.handle(new Map() as any);
      const body = await response.json();
      assertEquals(body.components.Y, "/y.tsx");
    });
  });

  describe("clearCache", () => {
    it("should clear in-memory cache", async () => {
      const manifest = new Map([
        ["Z", { path: "/z.tsx", exports: [] }],
      ]);

      const handler = new ManifestHandler("/project");
      await handler.handle(manifest as any);
      handler.clearCache();

      // After clear, new manifest should be used
      const manifest2 = new Map([
        ["W", { path: "/w.tsx", exports: [] }],
      ]);
      const response = await handler.handle(manifest2 as any);
      const body = await response.json();
      assertEquals(body.components.W, "/w.tsx");
      assertEquals(body.components.Z, undefined);
    });
  });
});
