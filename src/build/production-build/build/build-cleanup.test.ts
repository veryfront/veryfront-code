import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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
    it("destroys the transform cache without asynchronous placeholder work", () => {
      cleanupCaches();
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

    it("reports renderer cleanup failures", async () => {
      const renderer = {
        destroy: () => Promise.reject(new Error("cleanup failed")),
        renderPage: () => Promise.resolve({ html: "" }),
      } as unknown as import("#veryfront/rendering/index.ts").VeryfrontRenderer;

      await assertRejects(() => performCleanup(renderer), Error, "cleanup failed");
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
