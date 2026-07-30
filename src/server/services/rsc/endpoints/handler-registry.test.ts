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
import { createImportMapIdentity } from "#veryfront/modules/import-map/index.ts";

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
    keys() {
      return entries.keys();
    },
    get size() {
      return entries.size;
    },
  };
}

class BoundedExpiringHandlerCache implements HandlerCache<RSCDevServerHandler> {
  readonly deleteAttempts: string[] = [];
  private readonly entries = new Map<
    string,
    { value: RSCDevServerHandler; expiresAt: number }
  >();
  private now = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  advanceBy(milliseconds: number): void {
    this.now += milliseconds;
  }

  get(key: string): RSCDevServerHandler | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now) {
      this.entries.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: RSCDevServerHandler): void {
    this.removeExpired();
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  delete(key: string): boolean {
    this.deleteAttempts.push(key);
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  keys(): IterableIterator<string> {
    this.removeExpired();
    return this.entries.keys();
  }

  get size(): number {
    this.removeExpired();
    return this.entries.size;
  }

  private removeExpired(): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= this.now) this.entries.delete(key);
    }
  }
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

    it("uses captured cache-key codecs after shared-realm primordial poisoning", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      const staleProject = getRSCHandler("/project/a", "project-a");
      const otherProject = getRSCHandler("/project/b", "project-b");
      const original = {
        arrayIsArray: Array.isArray,
        jsonParse: JSON.parse,
        jsonStringify: JSON.stringify,
      };
      let reusedStaleProject = false;
      let remainingEntries = -1;

      try {
        Reflect.set(Array, "isArray", () => false);
        Reflect.set(JSON, "parse", () => {
          throw new Error("poisoned JSON.parse");
        });
        Reflect.set(JSON, "stringify", () => {
          throw new Error("poisoned JSON.stringify");
        });

        reusedStaleProject = getRSCHandler("/project/a", "project-a") === staleProject;
        invalidateRSCHandlersForProject("/project/a", "project-a");
        remainingEntries = cache.size;
      } finally {
        Reflect.set(Array, "isArray", original.arrayIsArray);
        Reflect.set(JSON, "parse", original.jsonParse);
        Reflect.set(JSON, "stringify", original.jsonStringify);
      }

      assertEquals(reusedStaleProject, true);
      assertEquals(remainingEntries, 1);
      assertEquals(getRSCHandler("/project/b", "project-b"), otherProject);
      assertEquals(getRSCHandler("/project/a", "project-a") !== staleProject, true);
    });

    it("bounds invalidation work to capacity-retained handler variants", () => {
      const cache = new BoundedExpiringHandlerCache(5, 60_000);
      __injectCacheForTests(cache);

      for (let index = 0; index < 100; index++) {
        getRSCHandler("/project/a", "project-a", {
          releaseId: `release-${index}`,
          contentSourceId: `release-release-${index}`,
        });
      }
      const otherProject = getRSCHandler("/project/b", "project-b");

      assertEquals(cache.size, 5);
      cache.deleteAttempts.length = 0;
      invalidateRSCHandlersForProject("/project/a", "project-a");

      assertEquals(cache.deleteAttempts.length, 4);
      assertEquals(cache.size, 1);
      assertEquals(getRSCHandler("/project/b", "project-b"), otherProject);
    });

    it("does not retain or revisit TTL-expired handler variants", () => {
      const cache = new BoundedExpiringHandlerCache(50, 100);
      __injectCacheForTests(cache);

      for (let index = 0; index < 40; index++) {
        getRSCHandler("/project/a", "project-a", {
          releaseId: `release-${index}`,
          contentSourceId: `release-release-${index}`,
        });
      }
      cache.advanceBy(101);
      const otherProject = getRSCHandler("/project/b", "project-b");

      assertEquals(cache.size, 1);
      cache.deleteAttempts.length = 0;
      invalidateRSCHandlersForProject("/project/a", "project-a");

      assertEquals(cache.deleteAttempts.length, 0);
      assertEquals(cache.size, 1);
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
      assertEquals(
        cache.entries.has('["proj-123",false,"rsc-module","production","app",null]'),
        true,
      );
      assertEquals(
        cache.entries.has('["/dir",false,"rsc-module","production","app",null]'),
        false,
      );
    });

    it("should use projectDir as cache key when projectId is undefined", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      getRSCHandler("/project/dir");
      assertEquals(
        cache.entries.has('["/project/dir",false,"rsc-module","production","app",null]'),
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

    it("separates cached handlers by module strategy, mode, and configured app directory", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      const remote = getRSCHandler("/dir", "project", {
        config: { directories: { app: "app" } },
        isLocalProject: false,
        clientModuleStrategy: "rsc-module",
      });
      const local = getRSCHandler("/dir", "project", {
        config: { directories: { app: "app" } },
        isLocalProject: true,
        clientModuleStrategy: "fs",
      });
      const customApp = getRSCHandler("/dir", "project", {
        config: { directories: { app: "frontend" } },
        isLocalProject: false,
        clientModuleStrategy: "rsc-module",
      });
      const remotePreview = getRSCHandler("/dir", "project", {
        config: { directories: { app: "app" } },
        isLocalProject: false,
        clientModuleStrategy: "rsc-module",
        mode: "development",
      });

      assertEquals(remote !== local, true);
      assertEquals(remote !== customApp, true);
      assertEquals(remote !== remotePreview, true);
      assertEquals(cache.size, 4);
    });

    it("separates locality-dependent content identities even with the same strategy", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      const hosted = getRSCHandler("/dir", "project", {
        isLocalProject: false,
        clientModuleStrategy: "rsc-module",
        mode: "development",
      });
      const localProductionProfile = getRSCHandler("/dir", "project", {
        isLocalProject: true,
        clientModuleStrategy: "rsc-module",
        mode: "development",
      });

      assertEquals(hosted !== localProductionProfile, true);
      assertEquals(cache.size, 2);
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

    it("isolates one project and content source by exact import-map identity", async () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);
      const mapA = await createImportMapIdentity({
        imports: { package: "node:fs" },
      });
      const mapB = await createImportMapIdentity({
        imports: { package: "node:path" },
      });
      const options = {
        mode: "development" as const,
        contentSourceId: "preview-main",
      };

      const first = getRSCHandler("/dir", "project", {
        ...options,
        importMapIdentity: mapA,
      });
      const firstAgain = getRSCHandler("/dir", "project", {
        ...options,
        importMapIdentity: mapA,
      });
      const second = getRSCHandler("/dir", "project", {
        ...options,
        importMapIdentity: mapB,
      });

      assertEquals(firstAgain, first);
      assertEquals(second !== first, true);
      assertEquals(cache.size, 2);
    });

    it("does not cache explicit config maps without an exact merged identity", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);
      const options = {
        mode: "development" as const,
        contentSourceId: "preview-main",
      };

      const first = getRSCHandler("/dir", "project", {
        ...options,
        config: { resolve: { importMap: { imports: { package: "node:fs" } } } },
      });
      const second = getRSCHandler("/dir", "project", {
        ...options,
        config: { resolve: { importMap: { imports: { package: "node:path" } } } },
      });

      assertEquals(second !== first, true);
      assertEquals(cache.size, 0);
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
