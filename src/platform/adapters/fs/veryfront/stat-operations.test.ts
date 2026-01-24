import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FileCache } from "../cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { StatOperations } from "./stat-operations.ts";

describe("StatOperations", () => {
  describe("class", () => {
    it("should export StatOperations class", () => {
      assertExists(StatOperations);
      assertEquals(typeof StatOperations, "function");
    });
  });

  describe("instance", () => {
    const mockClient = {
      getRequestBranch: () => "main",
      listAllFiles: () => Promise.resolve([]),
      listPublishedFiles: () => Promise.resolve([]),
      searchFiles: () => Promise.resolve([]),
    } as any;

    const cache = new FileCache({ enabled: true, ttl: 1000, maxSize: 100 });
    const normalizer = new PathNormalizer();

    function createStatOps(contextProvider?: any): StatOperations {
      return new StatOperations(mockClient, cache, normalizer, contextProvider);
    }

    it("should be instantiable without production context", () => {
      assertExists(createStatOps());
    });

    it("should be instantiable with content context provider", () => {
      const contextProvider = {
        isProductionMode: () => false,
        getReleaseId: () => null,
        getContentContext: () => ({
          sourceType: "branch" as const,
          projectSlug: "test",
          branch: "main",
        }),
      };

      assertExists(createStatOps(contextProvider));
    });

    it("should have stat method", () => {
      const statOps = createStatOps();
      assertExists(statOps.stat);
      assertEquals(typeof statOps.stat, "function");
    });

    it("should have exists method", () => {
      const statOps = createStatOps();
      assertExists(statOps.exists);
      assertEquals(typeof statOps.exists, "function");
    });

    it("should have resolveFile method", () => {
      const statOps = createStatOps();
      assertExists(statOps.resolveFile);
      assertEquals(typeof statOps.resolveFile, "function");
    });

    it("should have clearIndex method", () => {
      const statOps = createStatOps();
      assertExists(statOps.clearIndex);
      assertEquals(typeof statOps.clearIndex, "function");
    });

    it("should have getOriginalApiPath method", () => {
      const statOps = createStatOps();
      assertExists(statOps.getOriginalApiPath);
      assertEquals(typeof statOps.getOriginalApiPath, "function");
    });

    it("getOriginalApiPath should return input path when no mapping exists", () => {
      const statOps = createStatOps();
      assertEquals(statOps.getOriginalApiPath("test/path.ts"), "test/path.ts");
    });

    it("should be callable to clear index", () => {
      createStatOps().clearIndex();
    });
  });
});
