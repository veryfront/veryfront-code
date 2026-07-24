import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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

    it("detaches cached manifest exports from caller-owned metadata", async () => {
      const exports = ["default"];
      const manifest = new Map([
        [
          "Widget",
          {
            id: "Widget",
            path: "/widget.js",
            exports,
          },
        ],
      ]);
      const handler = new ManifestHandler("/project");

      const first = await (await handler.handle(manifest)).json();
      exports.push("Widget");
      const second = await (await handler.handle(manifest)).json();
      const rebuilt = await (await new ManifestHandler("/project").handle(manifest)).json();

      assertEquals(first.modules[0].exports, ["default"]);
      assertEquals(second.modules[0].exports, ["default"]);
      assertEquals(second.hash, first.hash);
      assertEquals(rebuilt.modules[0].exports, ["default", "Widget"]);
      assertEquals(rebuilt.hash === first.hash, false);
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

    it("isolates external manifest cache entries by content source", async () => {
      const cacheRepo = createMockCacheRepo();
      const manifest = new Map([["Y", { path: "/y.tsx", exports: [] }]]);

      await new ManifestHandler("/project", {
        cacheRepo,
        contentSourceId: "release-a",
      }).handle(manifest as any);
      await new ManifestHandler("/project", {
        cacheRepo,
        contentSourceId: "release-b",
      }).handle(manifest as any);

      assertEquals(cacheRepo.store.size, 2);
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
      const handler = new ManifestHandler("/project", { fs: fs as any });

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
