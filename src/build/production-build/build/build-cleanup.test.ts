import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __injectCachesForTests,
  destroyTransformCache,
} from "#veryfront/transforms/esm/transform-cache.ts";
import {
  cleanupCaches,
  cleanupRenderer,
  logBuildCompletion,
  performCleanup,
} from "./build-cleanup.ts";

type CacheInjection = NonNullable<Parameters<typeof __injectCachesForTests>[0]>;
type InjectedLocalFallback = NonNullable<CacheInjection["localFallback"]>;

function injectTransformCacheClear(clear: () => void): void {
  const localFallback = {
    get: () => undefined,
    set: () => undefined,
    delete: () => false,
    has: () => false,
    clear,
    size: 0,
    entries: () => new Map().entries(),
  } as unknown as InjectedLocalFallback;
  __injectCachesForTests({ localFallback });
}

function restoreTransformCache(): void {
  __injectCachesForTests(null);
  destroyTransformCache();
}

describe("build/production-build/build/build-cleanup", () => {
  describe("cleanupRenderer", () => {
    it("should call destroy on renderer if available", async () => {
      let destroyCalled = false;
      const renderer = {
        destroy: async () => {
          destroyCalled = true;
        },
        renderPage: () => Promise.resolve({ html: "" }),
      } as unknown as import("#veryfront/rendering/index.ts").VeryfrontRenderer;
      await cleanupRenderer(renderer);
      assertEquals(destroyCalled, true);
    });

    it("should handle renderer without destroy method", async () => {
      const renderer = {
        renderPage: () => Promise.resolve({ html: "" }),
      } as unknown as import("#veryfront/rendering/index.ts").VeryfrontRenderer;
      // Should not throw
      await cleanupRenderer(renderer);
    });
  });

  describe("cleanupCaches", () => {
    it("destroys the transform cache", async () => {
      let clearCalls = 0;
      injectTransformCacheClear(() => clearCalls++);
      try {
        await cleanupCaches();
        assertEquals(clearCalls, 1);
      } finally {
        restoreTransformCache();
      }
    });

    it("propagates transform cache cleanup failures", async () => {
      const cleanupFailure = new Error("transform cache cleanup failed");
      injectTransformCacheClear(() => {
        throw cleanupFailure;
      });
      try {
        assertEquals(await assertRejects(() => cleanupCaches()), cleanupFailure);
      } finally {
        restoreTransformCache();
      }
    });
  });

  describe("performCleanup", () => {
    it("should call both cleanupRenderer and cleanupCaches", async () => {
      let destroyCalled = false;
      const renderer = {
        destroy: async () => {
          destroyCalled = true;
        },
        renderPage: () => Promise.resolve({ html: "" }),
      } as unknown as import("#veryfront/rendering/index.ts").VeryfrontRenderer;
      await performCleanup(renderer);
      assertEquals(destroyCalled, true);
    });

    it("attempts cache cleanup before propagating a renderer cleanup failure", async () => {
      const rendererFailure = new Error("renderer cleanup failed");
      let cacheClearCalls = 0;
      const renderer = {
        destroy: () => Promise.reject(rendererFailure),
        renderPage: () => Promise.resolve({ html: "" }),
      } as unknown as import("#veryfront/rendering/index.ts").VeryfrontRenderer;

      injectTransformCacheClear(() => cacheClearCalls++);
      try {
        assertEquals(await assertRejects(() => performCleanup(renderer)), rendererFailure);
        assertEquals(cacheClearCalls, 1);
      } finally {
        restoreTransformCache();
      }
    });

    it("aggregates renderer and cache cleanup failures", async () => {
      const rendererFailure = new Error("renderer cleanup failed");
      const cacheFailure = new Error("cache cleanup failed");
      const renderer = {
        destroy: () => Promise.reject(rendererFailure),
        renderPage: () => Promise.resolve({ html: "" }),
      } as unknown as import("#veryfront/rendering/index.ts").VeryfrontRenderer;

      injectTransformCacheClear(() => {
        throw cacheFailure;
      });
      try {
        const error = await assertRejects(
          () => performCleanup(renderer),
          AggregateError,
          "Production build runtime cleanup failed",
        );
        assertInstanceOf(error, AggregateError);
        assertEquals(error.errors, [rendererFailure, cacheFailure]);
      } finally {
        restoreTransformCache();
      }
    });
  });

  describe("logBuildCompletion", () => {
    it("should not throw for valid stats", () => {
      logBuildCompletion({
        pages: 10,
        components: 0,
        chunks: 5,
        assets: 3,
        totalSize: 1024 * 1024 * 2, // 2MB
        duration: 5000,
        ssgPaths: [],
      });
    });

    it("should handle zero values", () => {
      logBuildCompletion({
        pages: 0,
        components: 0,
        chunks: 0,
        assets: 0,
        totalSize: 0,
        duration: 0,
        ssgPaths: [],
      });
    });

    it("should handle very large values", () => {
      logBuildCompletion({
        pages: 10000,
        components: 0,
        chunks: 500,
        assets: 200,
        totalSize: 1024 * 1024 * 1024, // 1GB
        duration: 600000,
        ssgPaths: [],
      });
    });
  });
});
