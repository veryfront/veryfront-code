import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __destroyRSCHandlerForTests,
  __injectCacheForTests,
  __resetRSCHandlerForTests,
  getRSCHandler,
  type HandlerCache,
  invalidateRSCHandlersForProject,
} from "./handler-registry.ts";
import type { RSCDevServerHandler } from "../orchestrators/index.ts";

function createStubCache(): HandlerCache<RSCDevServerHandler> & {
  entries: Map<string, RSCDevServerHandler>;
} {
  const entries = new Map<string, RSCDevServerHandler>();
  return {
    entries,
    get(key: string) {
      return entries.get(key);
    },
    set(key: string, value: RSCDevServerHandler) {
      entries.set(key, value);
    },
    delete(key: string) {
      return entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

describe("server/services/rsc/endpoints/handler-registry", () => {
  afterEach(() => {
    __destroyRSCHandlerForTests();
  });

  it("does not inspect project dependencies until a handler is used", async () => {
    const cache = createStubCache();
    __injectCacheForTests(cache);
    const originalStat = Deno.stat;
    const projectDir = "/project/lazy-react-version";
    let statCalls = 0;

    Deno.stat = (path: string | URL) => {
      if (String(path).includes(projectDir)) statCalls++;
      return originalStat(path);
    };

    try {
      getRSCHandler(projectDir);
      await Deno.stat(".");
      await new Promise((resolve) => setTimeout(resolve, 0));

      assertEquals(statCalls, 0);
    } finally {
      Deno.stat = originalStat;
    }
  });

  describe("invalidateRSCHandlersForProject", () => {
    it("evicts every handler variant for only the changed project", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      const staleProduction = getRSCHandler("/project/a", "project-a");
      const staleDevelopment = getRSCHandler("/project/a", "project-a", {
        mode: "development",
      });
      const otherProject = getRSCHandler("/project/b", "project-b");

      invalidateRSCHandlersForProject("/project/a", "project-a");

      assertEquals(cache.size, 1);
      assertEquals(getRSCHandler("/project/a", "project-a") !== staleProduction, true);
      assertEquals(
        getRSCHandler("/project/a", "project-a", { mode: "development" }) !==
          staleDevelopment,
        true,
      );
      assertEquals(getRSCHandler("/project/b", "project-b"), otherProject);
    });
  });

  describe("getRSCHandler", () => {
    it("should create a new handler for a project", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      const handler = getRSCHandler("/project/dir");
      assertEquals(cache.size, 1);
      assertEquals(!!handler, true);
    });

    it("should return cached handler for same projectDir", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      const handler1 = getRSCHandler("/project/dir");
      const handler2 = getRSCHandler("/project/dir");
      assertEquals(handler1, handler2);
      assertEquals(cache.size, 1);
    });

    it("should use projectId as cache key when provided", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      getRSCHandler("/dir", "proj-123");
      assertEquals(cache.entries.has('["proj-123",false,"production","app",null]'), true);
      assertEquals(cache.entries.has('["/dir",false,"production","app",null]'), false);
    });

    it("should use projectDir as cache key when projectId is undefined", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      getRSCHandler("/project/dir");
      assertEquals(
        cache.entries.has('["/project/dir",false,"production","app",null]'),
        true,
      );
    });

    it("should create separate handlers for different projects", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      const handler1 = getRSCHandler("/dir1");
      const handler2 = getRSCHandler("/dir2");
      assertEquals(handler1 !== handler2, true);
      assertEquals(cache.size, 2);
    });

    it("separates cached handlers by trusted local mode and configured app directory", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      const remote = getRSCHandler("/dir", "project", {
        config: { directories: { app: "app" } },
        isLocalProject: false,
      });
      const local = getRSCHandler("/dir", "project", {
        config: { directories: { app: "app" } },
        isLocalProject: true,
      });
      const customApp = getRSCHandler("/dir", "project", {
        config: { directories: { app: "frontend" } },
        isLocalProject: false,
      });
      const remotePreview = getRSCHandler("/dir", "project", {
        config: { directories: { app: "app" } },
        isLocalProject: false,
        mode: "development",
      });

      assertEquals(remote !== local, true);
      assertEquals(remote !== customApp, true);
      assertEquals(remote !== remotePreview, true);
      assertEquals(cache.size, 4);
    });

    it("separates cached handlers by configured React version", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      const react18 = getRSCHandler("/dir", "project", {
        config: { react: { version: "18.3.1" } },
      });
      const react19 = getRSCHandler("/dir", "project", {
        config: { client: { cdn: { versions: { react: "19.1.1" } } } },
      });

      assertEquals(react18 !== react19, true);
      assertEquals(cache.size, 2);
    });

    it("isolates production handlers by release and content source", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      const releaseA = getRSCHandler("/dir", "project", {
        mode: "production",
        releaseId: "release-a",
        contentSourceId: "release-release-a",
      });
      const releaseB = getRSCHandler("/dir", "project", {
        mode: "production",
        releaseId: "release-b",
        contentSourceId: "release-release-b",
      });

      assertEquals(releaseA !== releaseB, true);
      assertEquals(cache.size, 2);
    });
  });

  describe("__resetRSCHandlerForTests", () => {
    it("should clear all cached handlers", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      getRSCHandler("/dir1");
      getRSCHandler("/dir2");
      assertEquals(cache.size, 2);

      __resetRSCHandlerForTests();
      assertEquals(cache.size, 0);
    });
  });

  describe("__destroyRSCHandlerForTests", () => {
    it("should remove injected cache", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);
      getRSCHandler("/dir");
      assertEquals(cache.size, 1);

      __destroyRSCHandlerForTests();

      // After destroy, a new call should create a new handler (using default cache)
      // We just verify no errors
      const cache2 = createStubCache();
      __injectCacheForTests(cache2);
      getRSCHandler("/dir");
      assertEquals(cache2.size, 1);
    });
  });
});
