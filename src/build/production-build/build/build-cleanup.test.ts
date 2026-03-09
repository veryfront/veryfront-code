import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
    it("should not throw when transform cache module is not available", async () => {
      // This test verifies the catch block handles missing module gracefully
      await cleanupCaches();
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
