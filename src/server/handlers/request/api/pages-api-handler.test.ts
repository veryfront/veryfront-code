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
  resetApiHandler,
  resetApiHandlerForProject,
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
      projectSlug: input.projectSlug ?? "test-project",
      mode: input.mode ?? "preview",
      branch: "main",
    },
  };
}

describe("server/handlers/request/api/pages-api-handler", () => {
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
    it("should not reuse stale preview route maps after source changes", async () => {
      const adapter = createMockAdapter();
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
    });

    it("should cache production route handlers by release context", async () => {
      const cache = createMockCache();
      const adapter = createMockAdapter();
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
    });
  });
});
