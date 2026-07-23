import "#veryfront/schemas/_test-setup.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
  refreshLoggerConfig,
} from "#veryfront/utils/logger/logger.ts";
import { __injectDepsForTests as __injectApiRouteDepsForTests } from "#veryfront/routing/api/handler.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import {
  __injectCacheForTests,
  getApiHandler,
  type HandlerCache,
  LRUHandlerCache,
  resetApiHandler,
  resetApiHandlerForProject,
  withApiHandler,
} from "./pages-api-handler.ts";
import { getPagesApiHandlerCacheKey } from "./pages-api-cache.ts";

type MockHandler = { destroyed: boolean; destroy(): void };

function createMockCache(): HandlerCache<Promise<MockHandler>> & {
  store: Map<string, Promise<MockHandler>>;
} {
  const store = new Map<string, Promise<MockHandler>>();
  return {
    store,
    get(key: string) {
      return store.get(key);
    },
    set(key: string, value: Promise<MockHandler>) {
      store.set(key, value);
    },
    delete(key: string) {
      return store.delete(key);
    },
    clear() {
      store.clear();
    },
    entries() {
      return store.entries();
    },
    values() {
      return store.values();
    },
  };
}

function createMockHandler(): MockHandler {
  return {
    destroyed: false,
    destroy() {
      this.destroyed = true;
    },
  };
}

afterEach(async () => {
  await resetApiHandler();
  __injectCacheForTests(null);
  __injectApiRouteDepsForTests(null);
  __resetLogRecordEmitterForTests();
});

function createHandlerContext(
  input: {
    adapter: ReturnType<typeof createMockAdapter>;
    projectDir?: string;
    projectSlug?: string;
    mode?: "preview" | "production";
    releaseId?: string;
  },
): HandlerContext {
  return {
    projectDir: input.projectDir ?? "/project-dir",
    adapter: input.adapter,
    securityConfig: null,
    cspUserHeader: null,
    projectSlug: input.projectSlug,
    projectId: input.projectSlug ? `${input.projectSlug}-id` : undefined,
    resolvedEnvironment: input.mode ?? "preview",
    releaseId: input.releaseId,
    requestContext: {
      token: "test-token",
      slug: input.projectSlug ?? "test-project",
      mode: input.mode ?? "preview",
      branch: "main",
    },
  };
}

function cacheKey(
  input: Parameters<typeof createHandlerContext>[0],
): string {
  const key = getPagesApiHandlerCacheKey(createHandlerContext(input));
  assertExists(key);
  return key;
}

describe("server/handlers/request/api/pages-api-handler", () => {
  describe("cache identity", () => {
    it("disables caching when the ambient project or release identity disagrees", () => {
      const ctx = createHandlerContext({
        adapter: createMockAdapter(),
        projectSlug: "my-project",
        mode: "production",
        releaseId: "release-1",
      });

      const otherProject = runWithCacheKeyContext(
        { projectId: "other-project-id", mode: "production", versionId: "release-1" },
        () => getPagesApiHandlerCacheKey(ctx),
      );
      const otherRelease = runWithCacheKeyContext(
        { projectId: "my-project-id", mode: "production", versionId: "release-2" },
        () => getPagesApiHandlerCacheKey(ctx),
      );

      assertEquals(otherProject, null);
      assertEquals(otherRelease, null);
    });
  });

  describe("LRUHandlerCache", () => {
    it("should clean up automatically evicted handlers without cleaning up manual removals", async () => {
      const evicted: MockHandler[] = [];
      const cache = new LRUHandlerCache<Promise<MockHandler>>({
        maxEntries: 1,
        onEvict: (promise) => {
          void promise.then((handler) => evicted.push(handler));
        },
      });
      const first = createMockHandler();
      const second = createMockHandler();

      cache.set("first", Promise.resolve(first));
      cache.set("second", Promise.resolve(second));
      await Promise.resolve();

      assertEquals(evicted, [first]);

      cache.delete("second");
      await Promise.resolve();
      assertEquals(evicted, [first]);
    });

    it("cleans up a replaced resource without destroying an identical value", async () => {
      const evicted: MockHandler[] = [];
      const cache = new LRUHandlerCache<Promise<MockHandler>>({
        onEvict: (promise) => void promise.then((handler) => evicted.push(handler)),
      });
      const first = createMockHandler();
      const second = createMockHandler();
      const firstPromise = Promise.resolve(first);

      cache.set("resource", firstPromise);
      cache.set("resource", firstPromise);
      await Promise.resolve();
      assertEquals(evicted, []);

      cache.set("resource", Promise.resolve(second));
      await Promise.resolve();
      assertEquals(evicted, [first]);
    });
  });

  describe("resetApiHandler", () => {
    it("should clear a specific project entry by key", async () => {
      const cache = createMockCache();
      const handler = createMockHandler();
      cache.set(cacheKey({ adapter: createMockAdapter() }), Promise.resolve(handler));
      __injectCacheForTests(cache as any);

      await resetApiHandler("/project-dir");
      assertEquals(cache.store.size, 0);
      assertEquals(handler.destroyed, true);
    });

    it("should clear all entries when no projectDir specified", async () => {
      const cache = createMockCache();
      const h1 = createMockHandler();
      const h2 = createMockHandler();
      cache.set("/dir1", Promise.resolve(h1));
      cache.set("/dir2", Promise.resolve(h2));
      __injectCacheForTests(cache as any);

      await resetApiHandler();
      assertEquals(cache.store.size, 0);
      assertEquals(h1.destroyed, true);
      assertEquals(h2.destroyed, true);
    });

    it("should handle missing entry gracefully", async () => {
      const cache = createMockCache();
      __injectCacheForTests(cache as any);

      // Should not throw
      await resetApiHandler("/nonexistent");
      assertEquals(cache.store.size, 0);
    });

    it("does not expose handler cleanup failures in logs", async () => {
      const previousLogLevel = Deno.env.get("LOG_LEVEL");
      Deno.env.set("LOG_LEVEL", "DEBUG");
      refreshLoggerConfig();
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));
      const cache = createMockCache();
      cache.set(
        cacheKey({ adapter: createMockAdapter() }),
        Promise.resolve({
          destroyed: false,
          destroy() {
            throw new Error("PRIVATE_HANDLER_CLEANUP_FAILURE /private/project/route.ts");
          },
        }),
      );
      __injectCacheForTests(cache as any);

      try {
        await resetApiHandler("/project-dir");
      } finally {
        if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", previousLogLevel);
        refreshLoggerConfig();
      }

      const cleanupEntry = entries.find((entry) => entry.message === "Failed to destroy handler");
      assertEquals(cleanupEntry?.context, { errorName: "Error" });
      const serialized = JSON.stringify(entries);
      assertEquals(serialized.includes("PRIVATE_HANDLER_CLEANUP_FAILURE"), false);
      assertEquals(serialized.includes("/private/project/route.ts"), false);
    });

    it("clears every release-scoped entry for a project directory", async () => {
      const cache = createMockCache();
      const exact = createMockHandler();
      const firstRelease = createMockHandler();
      const secondRelease = createMockHandler();
      const other = createMockHandler();
      cache.set(cacheKey({ adapter: createMockAdapter() }), Promise.resolve(exact));
      cache.set(
        cacheKey({
          adapter: createMockAdapter(),
          projectSlug: "my-project",
          mode: "production",
          releaseId: "release-1",
        }),
        Promise.resolve(firstRelease),
      );
      cache.set(
        cacheKey({
          adapter: createMockAdapter(),
          projectSlug: "my-project",
          mode: "production",
          releaseId: "release-2",
        }),
        Promise.resolve(secondRelease),
      );
      const otherKey = cacheKey({
        adapter: createMockAdapter(),
        projectDir: "/project-directory",
      });
      cache.set(otherKey, Promise.resolve(other));
      __injectCacheForTests(cache as any);

      await resetApiHandler("/project-dir");

      assertEquals([...cache.store.keys()], [otherKey]);
      assertEquals(exact.destroyed, true);
      assertEquals(firstRelease.destroyed, true);
      assertEquals(secondRelease.destroyed, true);
      assertEquals(other.destroyed, false);
    });

    it("does not clear a sibling directory whose name extends the target", async () => {
      const cache = createMockCache();
      __injectCacheForTests(cache as any);

      await getApiHandler(createHandlerContext({
        adapter: createMockAdapter(),
        projectDir: "/project",
        projectSlug: "target-project",
        mode: "production",
        releaseId: "release-1",
      }));
      await getApiHandler(createHandlerContext({
        adapter: createMockAdapter(),
        projectDir: "/project:archive",
        projectSlug: "other-project",
        mode: "production",
        releaseId: "release-1",
      }));

      await resetApiHandler("/project");

      assertEquals(cache.store.size, 1);
    });
  });

  describe("resetApiHandlerForProject", () => {
    it("should clear entries matching project slug suffix", async () => {
      const cache = createMockCache();
      const h1 = createMockHandler();
      const h2 = createMockHandler();
      const h3 = createMockHandler();
      const h4 = createMockHandler();
      cache.set(
        cacheKey({
          adapter: createMockAdapter(),
          projectDir: "/dir",
          projectSlug: "my-project",
          mode: "production",
          releaseId: "release-1",
        }),
        Promise.resolve(h1),
      );
      cache.set(
        cacheKey({
          adapter: createMockAdapter(),
          projectDir: "/other",
          projectSlug: "my-project",
          mode: "production",
          releaseId: "release-2",
        }),
        Promise.resolve(h2),
      );
      const otherKey = cacheKey({
        adapter: createMockAdapter(),
        projectDir: "/dir",
        projectSlug: "other-project",
        mode: "production",
        releaseId: "release-1",
      });
      cache.set(otherKey, Promise.resolve(h3));
      cache.set(
        cacheKey({
          adapter: createMockAdapter(),
          projectDir: "/dir",
          projectSlug: "my-project",
          mode: "production",
          releaseId: "release-3",
        }),
        Promise.resolve(h4),
      );
      __injectCacheForTests(cache as any);

      await resetApiHandlerForProject("my-project");
      assertEquals(cache.store.size, 1);
      assertEquals(cache.store.has(otherKey), true);
      assertEquals(h1.destroyed, true);
      assertEquals(h2.destroyed, true);
      assertEquals(h3.destroyed, false);
      assertEquals(h4.destroyed, true);
    });

    it("should match exact slug key", async () => {
      const cache = createMockCache();
      const handler = createMockHandler();
      cache.set(
        cacheKey({
          adapter: createMockAdapter(),
          projectSlug: "my-project",
          mode: "production",
          releaseId: "release-1",
        }),
        Promise.resolve(handler),
      );
      __injectCacheForTests(cache as any);

      await resetApiHandlerForProject("my-project");
      assertEquals(cache.store.size, 0);
      assertEquals(handler.destroyed, true);
    });

    it("should handle no matching entries gracefully", async () => {
      const cache = createMockCache();
      cache.set(
        cacheKey({
          adapter: createMockAdapter(),
          projectSlug: "other",
          mode: "production",
          releaseId: "release-1",
        }),
        Promise.resolve(createMockHandler()),
      );
      __injectCacheForTests(cache as any);

      await resetApiHandlerForProject("nonexistent");
      assertEquals(cache.store.size, 1);
    });

    it("does not remove a different project whose directory contains the slug", async () => {
      const cache = createMockCache();
      const target = createMockHandler();
      const unrelated = createMockHandler();
      const targetKey = cacheKey({
        adapter: createMockAdapter(),
        projectDir: "/dir",
        projectSlug: "my-project",
        mode: "production",
        releaseId: "release-1",
      });
      const unrelatedKey = cacheKey({
        adapter: createMockAdapter(),
        projectDir: "/workspace/:my-project:/other",
        projectSlug: "other",
        mode: "production",
        releaseId: "release-1",
      });
      cache.set(targetKey, Promise.resolve(target));
      cache.set(unrelatedKey, Promise.resolve(unrelated));
      __injectCacheForTests(cache as any);

      await resetApiHandlerForProject("my-project");

      assertEquals(cache.store.has(targetKey), false);
      assertEquals(cache.store.has(unrelatedKey), true);
      assertEquals(target.destroyed, true);
      assertEquals(unrelated.destroyed, false);
    });

    it("does not treat a directory segment as the owning project slug", async () => {
      const cache = createMockCache();
      __injectCacheForTests(cache as any);

      await getApiHandler(createHandlerContext({
        adapter: createMockAdapter(),
        projectDir: "/workspace",
        projectSlug: "my-project",
        mode: "production",
        releaseId: "release-1",
      }));
      await getApiHandler(createHandlerContext({
        adapter: createMockAdapter(),
        projectDir: "/workspace:my-project:production",
        projectSlug: "archive",
        mode: "production",
        releaseId: "release-1",
      }));

      await resetApiHandlerForProject("my-project");

      assertEquals(cache.store.size, 1);
    });
  });

  describe("getApiHandler", () => {
    it("evicts a rejected initialization so the same release can retry", async () => {
      const cache = createMockCache();
      const adapter = createMockAdapter();
      adapter.fs.exists = (path) => Promise.resolve(path.endsWith("/pages/api"));
      __injectCacheForTests(cache as any);
      __injectApiRouteDepsForTests({
        discoverPagesRoutes: () => Promise.reject(new Error("discovery unavailable")),
      });
      const ctx = createHandlerContext({
        adapter,
        projectSlug: "my-project",
        mode: "production",
        releaseId: "release-1",
      });

      await assertRejects(() => getApiHandler(ctx), Error, "discovery unavailable");

      assertEquals(cache.store.size, 0);
    });

    it("keeps a cached handler alive between lookup and request handling", async () => {
      const cache = createMockCache();
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project-dir/pages/api/status.ts",
        "export function GET() { return new Response('ok'); }",
      );
      __injectCacheForTests(cache as any);
      __injectApiRouteDepsForTests({
        loadHandlerModule: () =>
          Promise.resolve({
            GET: () => new Response("ok"),
          }),
      });
      const ctx = createHandlerContext({
        adapter,
        projectSlug: "my-project",
        mode: "production",
        releaseId: "release-1",
      });
      const acquired = Promise.withResolvers<void>();
      const continueToHandle = Promise.withResolvers<void>();
      let retainedHandler: Awaited<ReturnType<typeof getApiHandler>> | undefined;

      const responsePromise = withApiHandler(ctx, async (handler) => {
        retainedHandler = handler;
        acquired.resolve();
        await continueToHandle.promise;
        return handler.handle(new Request("http://localhost/api/status"), ctx);
      });

      await acquired.promise;
      await resetApiHandler();
      continueToHandle.resolve();

      const response = await responsePromise;
      assertEquals(response?.status, 200);
      assertEquals(await response?.text(), "ok");

      const responseAfterRelease = await retainedHandler!.handle(
        new Request("http://localhost/api/status"),
        ctx,
      );
      assertEquals(responseAfterRelease?.status, 404);
    });

    it("should not reuse stale preview route maps after source changes", async () => {
      const adapter = createMockAdapter();
      let refreshCalls = 0;
      (adapter.fs as unknown as { refreshSourceSnapshot?: (reason?: string) => Promise<void> })
        .refreshSourceSnapshot = (reason?: string) => {
          refreshCalls++;
          assertEquals(reason, "preview-api-route-discovery");
          return Promise.resolve();
        };
      const ctx = createHandlerContext({
        adapter,
        projectSlug: "my-project",
        mode: "preview",
      });

      __injectApiRouteDepsForTests({
        loadHandlerModule: () =>
          Promise.resolve({
            POST: () => Response.json({ ok: true }),
          }),
      });

      const missingHandler = await getApiHandler(ctx);
      const missingResponse = await missingHandler.handle(
        new Request("http://localhost/api/ag-ui", { method: "POST" }),
        ctx,
      );

      assertExists(missingResponse);
      assertEquals(missingResponse.status, 404);

      adapter.fs.files.set(
        "/project-dir/pages/api/ag-ui.ts",
        "export function POST() { return Response.json({ ok: true }); }",
      );

      const updatedHandler = await getApiHandler(ctx);
      const updatedResponse = await updatedHandler.handle(
        new Request("http://localhost/api/ag-ui", { method: "POST" }),
        ctx,
      );

      assertExists(updatedResponse);
      assertEquals(updatedResponse.status, 200);
      assertEquals(await updatedResponse.json(), { ok: true });
      assertEquals(refreshCalls, 2);
    });

    it("should cache production route handlers by release context", async () => {
      const cache = createMockCache();
      const adapter = createMockAdapter();
      let refreshCalls = 0;
      (adapter.fs as unknown as { refreshSourceSnapshot?: (reason?: string) => Promise<void> })
        .refreshSourceSnapshot = () => {
          refreshCalls++;
          return Promise.resolve();
        };
      __injectCacheForTests(cache as any);

      await getApiHandler(
        createHandlerContext({
          adapter,
          projectSlug: "my-project",
          mode: "production",
          releaseId: "release-1",
        }),
      );
      await getApiHandler(
        createHandlerContext({
          adapter,
          projectSlug: "my-project",
          mode: "production",
          releaseId: "release-1",
        }),
      );
      await getApiHandler(
        createHandlerContext({
          adapter,
          projectSlug: "my-project",
          mode: "production",
          releaseId: "release-2",
        }),
      );

      assertEquals(cache.store.size, 2);
      assertEquals(new Set(cache.store.keys()).size, 2);
      assertEquals(refreshCalls, 0);
    });
  });
});
