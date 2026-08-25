import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ManifestHandler } from "./manifest-handler.ts";
import type { CacheRepository } from "#veryfront/repositories/types.ts";
import { RSC_DEPENDENCY_PINNING_HEADER } from "#veryfront/rendering/rsc/constants.ts";
import { RSC_MANIFEST_CACHE_TTL_MS } from "#veryfront/utils";

function createMockCacheRepo(): CacheRepository<string> & {
  store: Map<string, string>;
  ttls: Map<string, number | undefined>;
} {
  const store = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();
  return {
    store,
    ttls,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, ttl?: number) {
      store.set(key, value);
      ttls.set(key, ttl);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async has(key: string) {
      return store.has(key);
    },
  } as CacheRepository<string> & {
    store: Map<string, string>;
    ttls: Map<string, number | undefined>;
  };
}

describe("server/services/rsc/orchestrators/manifest-handler", () => {
  describe("handle", () => {
    it("should return JSON response with components map", async () => {
      const manifest = new Map([
        ["Button", { path: "/app/components/Button.tsx", exports: [] }],
        ["Card", { path: "/app/components/Card.tsx", exports: [] }],
      ]);

      const handler = new ManifestHandler("/project", { isLocalProject: true });
      const response = await handler.handle(manifest as any);

      assertEquals(response.headers.get("content-type"), "application/json");
      assertEquals(response.headers.get("vary"), RSC_DEPENDENCY_PINNING_HEADER);
      assertEquals(
        response.headers.get("cache-control"),
        "private, no-cache, must-revalidate",
        "a per-tenant client-component manifest must never be shared-cacheable",
      );
      const body = await response.json();
      assertEquals(body.components.Button, "/app/components/Button.tsx");
      assertEquals(body.components.Card, "/app/components/Card.tsx");
    });

    it("should return empty components for empty manifest", async () => {
      const handler = new ManifestHandler("/project", { isLocalProject: true });
      const response = await handler.handle(new Map());
      const body = await response.json();
      assertEquals(body.components, {});
    });

    it("builds manifests through the request filesystem adapter", async () => {
      const fs = {
        readDir: async function* (path: string) {
          if (path === "/project/frontend") {
            yield {
              name: "Counter.tsx",
              isFile: true,
              isDirectory: false,
              isSymlink: false,
            };
          }
        },
        readFile: (path: string) => {
          if (path === "/project/frontend/Counter.tsx") {
            return Promise.resolve(
              `'use client';\nexport default function Counter() { return null; }`,
            );
          }
          return Promise.reject(new Error("not found"));
        },
      };
      const handler = new ManifestHandler("/project", {
        appDir: "frontend",
        isLocalProject: false,
        fs: fs as any,
        contentSourceId: "release-a",
      });

      const body = await (await handler.handle(null)).json();

      assertEquals(
        body.components.Counter.startsWith("/_veryfront/rsc/module?rel=frontend%2FCounter.tsx"),
        true,
      );
    });

    it("emits a versioned strategy-aware hydration manifest", async () => {
      const manifest = new Map([
        [
          "Button",
          {
            id: "Button",
            path: "/_veryfront/fs/local-button.js",
            sourcePath: "/project/frontend/Button.tsx",
            rel: "frontend/Button.tsx",
            contentHash: "rev-a",
            exports: ["default", "Button"],
          },
        ],
      ]);
      const localHandler = new ManifestHandler("/project", {
        appDir: "frontend",
        isLocalProject: true,
      });
      const remoteHandler = new ManifestHandler("/project", {
        appDir: "frontend",
        isLocalProject: false,
      });

      const local = await (await localHandler.handle(manifest)).json();
      const remote = await (await remoteHandler.handle(manifest)).json();

      assertEquals(local.version, 1);
      assertEquals(typeof local.hash, "string");
      assertEquals(local.hash.length > 0, true);
      assertEquals(local.components.Button, "/_veryfront/fs/local-button.js?v=rev-a");
      assertEquals(local.graphIds.client, [{
        id: "Button",
        path: "/project/frontend/Button.tsx",
        rel: "frontend/Button.tsx",
      }]);
      assertEquals(
        remote.components.Button,
        "/_veryfront/rsc/module?rel=frontend%2FButton.tsx&v=rev-a",
      );
      assertEquals(remote.graphIds.client, [{
        id: "Button",
        path: "frontend/Button.tsx",
        rel: "frontend/Button.tsx",
      }]);
      assertEquals(remote.modules, [{
        id: "Button",
        clientRef: "/_veryfront/rsc/module?rel=frontend%2FButton.tsx&v=rev-a#Button",
        exports: ["default", "Button"],
      }]);
      const serializedRemoteManifest = JSON.stringify(remote);
      assertEquals(serializedRemoteManifest.includes("/_veryfront/fs/"), false);
      assertEquals(serializedRemoteManifest.includes("/project/"), false);
      assertEquals(serializedRemoteManifest.includes("local-button"), false);
      assertEquals(
        serializedRemoteManifest.includes(btoa("/project/frontend/Button.tsx")),
        false,
      );

      const changedSourceHandler = new ManifestHandler("/project", {
        appDir: "frontend",
        isLocalProject: false,
      });
      const changedSource = await (await changedSourceHandler.handle(
        new Map([
          ["Button", { ...manifest.get("Button")!, contentHash: "rev-b" }],
        ]),
      )).json();
      assertEquals(changedSource.hash === remote.hash, false);
      assertEquals(changedSource.components.Button.includes("v=rev-b"), true);
    });

    it("should cache result on second call (in-memory)", async () => {
      const manifest = new Map([
        ["A", { path: "/a.tsx", exports: [] }],
      ]);

      const handler = new ManifestHandler("/project", { isLocalProject: true });
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

    it("invalidates manifest identity when dependency pins change", async () => {
      const manifest = new Map([
        [
          "Button",
          {
            id: "Button",
            path: "/project/frontend/Button.tsx",
            rel: "frontend/Button.tsx",
            contentHash: "source-a",
            exports: ["default"],
          },
        ],
      ]);
      const handler = new ManifestHandler("/project", {
        isLocalProject: false,
      });

      const stateA = await (await handler.handle(manifest, "on:pins-a")).json();
      const stateB = await (await handler.handle(manifest, "on:pins-b")).json();
      const stateBAgain = await (await handler.handle(new Map(), "on:pins-b")).json();

      assertEquals(stateA.hash === stateB.hash, false);
      assertEquals(
        stateA.components.Button,
        "/_veryfront/rsc/module?rel=frontend%2FButton.tsx&v=source-a&pins=on%3Apins-a",
      );
      assertEquals(
        stateB.components.Button,
        "/_veryfront/rsc/module?rel=frontend%2FButton.tsx&v=source-a&pins=on%3Apins-b",
      );
      assertEquals(stateBAgain.hash, stateB.hash);
      assertEquals(stateB.dependencyPinningCacheKey, "on:pins-b");
    });

    it("defaults an omitted isLocalProject to remote", async () => {
      const manifest = new Map([
        [
          "Button",
          {
            id: "Button",
            path: "/project/frontend/Button.tsx",
            rel: "frontend/Button.tsx",
            contentHash: "rev-a",
            exports: ["default"],
          },
        ],
      ]);

      const body = await (await new ManifestHandler("/project").handle(manifest)).json();

      assertEquals(
        body.components.Button,
        "/_veryfront/rsc/module?rel=frontend%2FButton.tsx&v=rev-a",
      );
      assertEquals(JSON.stringify(body).includes("/project/frontend/Button.tsx"), false);
    });

    it("rejects a rel-less component when isLocalProject is omitted", async () => {
      const manifest = new Map([
        ["Button", { id: "Button", path: "/project/frontend/Button.tsx", exports: ["default"] }],
      ]);

      await assertRejects(
        () => new ManifestHandler("/project").handle(manifest),
        Error,
        "missing its project-relative module path",
      );
    });
  });

  describe("handle with injected CacheRepository", () => {
    it("should use injected cache repo for caching", async () => {
      const cacheRepo = createMockCacheRepo();
      const manifest = new Map([
        ["X", { path: "/x.tsx", exports: [] }],
      ]);

      const handler = new ManifestHandler("/project", { cacheRepo, isLocalProject: true });
      await handler.handle(manifest as any);

      assertEquals(cacheRepo.store.size, 1);
      const key = [...cacheRepo.store.keys()][0]!;
      assertEquals(
        cacheRepo.ttls.get(key),
        Math.floor(RSC_MANIFEST_CACHE_TTL_MS / 1000),
        "the external manifest TTL is written in seconds, not milliseconds",
      );
    });

    it("should return cached data from injected cache", async () => {
      const cacheRepo = createMockCacheRepo();
      const manifest = new Map([
        ["Y", { path: "/y.tsx", exports: [] }],
      ]);

      const handler = new ManifestHandler("/project", { cacheRepo, isLocalProject: true });
      await handler.handle(manifest as any);

      // Second call should use cache
      const response = await handler.handle(new Map() as any);
      const body = await response.json();
      assertEquals(body.components.Y, "/y.tsx");
    });

    it("isolates external manifest cache entries by content source", async () => {
      const cacheRepo = createMockCacheRepo();
      const manifest = new Map([["Y", { path: "/y.tsx", exports: [] }]]);

      await new ManifestHandler("/project", {
        cacheRepo,
        isLocalProject: true,
        contentSourceId: "release-a",
      }).handle(manifest as any);
      await new ManifestHandler("/project", {
        cacheRepo,
        isLocalProject: true,
        contentSourceId: "release-b",
      }).handle(manifest as any);

      assertEquals(cacheRepo.store.size, 2);
    });

    it("isolates external manifest cache entries by dependency pins", async () => {
      const cacheRepo = createMockCacheRepo();
      const manifest = new Map([
        [
          "Y",
          {
            path: "/project/y.tsx",
            rel: "y.tsx",
            contentHash: "source-a",
            exports: ["default"],
          },
        ],
      ]);
      const handler = new ManifestHandler("/project", {
        cacheRepo,
        isLocalProject: false,
      });

      await handler.handle(manifest as any, "on:pins-a");
      await handler.handle(manifest as any, "on:pins-b");

      assertEquals(cacheRepo.store.size, 2);
    });

    it("bounds tracked and external cache keys during dependency snapshot churn", async () => {
      const cacheRepo = createMockCacheRepo();
      const manifest = new Map([
        [
          "Y",
          {
            path: "/project/y.tsx",
            rel: "y.tsx",
            contentHash: "source-a",
            exports: ["default"],
          },
        ],
      ]);
      const handler = new ManifestHandler("/project", {
        cacheRepo,
        isLocalProject: false,
      });

      for (let index = 0; index < 70; index++) {
        await handler.handle(manifest as any, `on:pins-${index}`);
      }

      const trackedKeys = (handler as unknown as {
        knownCacheKeys: Set<string>;
      }).knownCacheKeys;
      assertEquals(trackedKeys.size, 64);
      assertEquals(cacheRepo.store.size, 64);
      assertEquals(
        [...cacheRepo.store.keys()].some((key) => key.endsWith(":on:pins-0")),
        false,
      );
      assertEquals(
        [...cacheRepo.store.keys()].some((key) => key.endsWith(":on:pins-69")),
        true,
      );
    });
  });

  describe("clearCache", () => {
    it("should clear in-memory cache", async () => {
      const manifest = new Map([
        ["Z", { path: "/z.tsx", exports: [] }],
      ]);

      const handler = new ManifestHandler("/project", { isLocalProject: true });
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

    it("purges tracked keys from the injected cache repository", async () => {
      const cacheRepo = createMockCacheRepo();
      const handler = new ManifestHandler("/project", { cacheRepo, isLocalProject: true });
      await handler.handle(new Map([["Z", { path: "/z.tsx", exports: [] }]]) as any);
      assertEquals(cacheRepo.store.size, 1, "the first build is written to the repository");

      handler.clearCache();
      // clearCache enqueues the purge with void, so await the private queue.
      await (handler as unknown as { cacheMutation: Promise<void> }).cacheMutation;

      assertEquals(
        cacheRepo.store.size,
        0,
        "clearCache must purge every tracked key from the external cache repository",
      );
      const response = await handler.handle(
        new Map([["W", { path: "/w.tsx", exports: [] }]]) as any,
      );
      const body = await response.json();
      assertEquals(
        body.components.Z,
        undefined,
        "a cleared manifest must not be re-read from the injected repository",
      );
      assertEquals(body.components.W, "/w.tsx", "the post-clear build is served");
    });

    it("does not let a pre-invalidation build republish stale manifest data", async () => {
      let resolveFirstRead!: () => void;
      let markFirstReadStarted!: () => void;
      let readCount = 0;
      const firstReadGate = new Promise<void>((resolve) => {
        resolveFirstRead = resolve;
      });
      const firstReadStarted = new Promise<void>((resolve) => {
        markFirstReadStarted = resolve;
      });
      const fs = {
        readDir: async function* (path: string) {
          if (path === "/project/app") {
            yield {
              name: "Counter.tsx",
              isFile: true,
              isDirectory: false,
              isSymlink: false,
            };
          }
        },
        async readFile() {
          readCount++;
          if (readCount === 1) {
            markFirstReadStarted();
            await firstReadGate;
            return `'use client';\nexport default function Counter() { return "stale"; }`;
          }
          return `'use client';\nexport default function Counter() { return "fresh"; }`;
        },
      };
      const handler = new ManifestHandler("/project", { fs: fs as any, isLocalProject: true });

      const preInvalidation = handler.handle(null);
      await firstReadStarted;
      handler.clearCache();
      const fresh = await (await handler.handle(null)).json();
      resolveFirstRead();
      const restarted = await (await preInvalidation).json();
      const cached = await (await handler.handle(null)).json();

      assertEquals(restarted.components.Counter, fresh.components.Counter);
      assertEquals(cached.components.Counter, fresh.components.Counter);
      assertEquals(readCount, 2);
    });
  });
});
