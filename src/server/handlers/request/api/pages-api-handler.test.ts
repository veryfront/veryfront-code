import "#veryfront/schemas/_test-setup.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { __injectDepsForTests as __injectApiRouteDepsForTests } from "#veryfront/routing/api/handler.ts";
import {
  __injectCacheForTests,
  getApiHandler,
  type HandlerCache,
  LRUHandlerCache,
  resetApiHandler,
  resetApiHandlerForProject,
  withApiHandler,
} from "./pages-api-handler.ts";

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

describe("server/handlers/request/api/pages-api-handler", () => {
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
  });

  describe("resetApiHandler", () => {
    it("should clear a specific project entry by key", async () => {
      const cache = createMockCache();
      const handler = createMockHandler();
      cache.set("/project-dir", Promise.resolve(handler));
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
  });

  describe("resetApiHandlerForProject", () => {
    it("should clear entries matching project slug suffix", async () => {
      const cache = createMockCache();
      const h1 = createMockHandler();
      const h2 = createMockHandler();
      const h3 = createMockHandler();
      const h4 = createMockHandler();
      cache.set("/dir:my-project", Promise.resolve(h1));
      cache.set("/other:my-project", Promise.resolve(h2));
      cache.set("/dir:other-project", Promise.resolve(h3));
      cache.set("/dir:my-project:production:release-1", Promise.resolve(h4));
      __injectCacheForTests(cache as any);

      await resetApiHandlerForProject("my-project");
      assertEquals(cache.store.size, 1);
      assertEquals(cache.store.has("/dir:other-project"), true);
      assertEquals(h1.destroyed, true);
      assertEquals(h2.destroyed, true);
      assertEquals(h3.destroyed, false);
      assertEquals(h4.destroyed, true);
    });

    it("should match exact slug key", async () => {
      const cache = createMockCache();
      const handler = createMockHandler();
      cache.set("my-project", Promise.resolve(handler));
      __injectCacheForTests(cache as any);

      await resetApiHandlerForProject("my-project");
      assertEquals(cache.store.size, 0);
      assertEquals(handler.destroyed, true);
    });

    it("should handle no matching entries gracefully", async () => {
      const cache = createMockCache();
      cache.set("/dir:other", Promise.resolve(createMockHandler()));
      __injectCacheForTests(cache as any);

      await resetApiHandlerForProject("nonexistent");
      assertEquals(cache.store.size, 1);
    });
  });

  describe("getApiHandler", () => {
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
      assertEquals(
        [...cache.store.keys()].sort(),
        [
          "/project-dir:my-project:production:release-1",
          "/project-dir:my-project:production:release-2",
        ],
      );
      assertEquals(refreshCalls, 0);
    });
  });
});
