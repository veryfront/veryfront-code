import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getCachedTransform,
  setCachedTransform,
} from "#veryfront/transforms/esm/transform-cache.ts";
import {
  cleanupCaches,
  cleanupRenderer,
  logBuildCompletion,
  performCleanup,
} from "./build-cleanup.ts";

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
    it("clears the transform cache", async () => {
      setCachedTransform("build-cleanup-probe", "export const a = 1;", "hash");
      assertExists(
        getCachedTransform("build-cleanup-probe"),
        "the probe entry must be cached before cleanup",
      );

      await cleanupCaches();

      assertEquals(
        getCachedTransform("build-cleanup-probe"),
        undefined,
        "cleanupCaches must destroy the transform cache",
      );
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

    it("does not mask an active build failure when renderer cleanup also fails", async () => {
      const buildError = new Error("build failed");
      const renderer = {
        destroy: () => Promise.reject(new Error("cleanup failed")),
        renderPage: () => Promise.resolve({ html: "" }),
      } as unknown as import("#veryfront/rendering/index.ts").VeryfrontRenderer;

      const error = await assertRejects(async () => {
        try {
          throw buildError;
        } finally {
          await performCleanup(renderer);
        }
      });

      assertEquals(error, buildError);
    });
  });

  describe("logBuildCompletion", () => {
    it("should not throw for valid stats", () => {
      logBuildCompletion({
        pages: 10,
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
        chunks: 500,
        assets: 200,
        totalSize: 1024 * 1024 * 1024, // 1GB
        duration: 600000,
        ssgPaths: [],
      });
    });
  });
});
