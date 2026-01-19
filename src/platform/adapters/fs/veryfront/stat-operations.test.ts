import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { StatOperations } from "./stat-operations.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { FileCache } from "../cache/file-cache.ts";

describe("StatOperations", () => {
  describe("class", () => {
    it("should export StatOperations class", () => {
      assertExists(StatOperations);
      assertEquals(typeof StatOperations, "function");
    });
  });

  describe("instance", () => {
    // Create minimal mock objects for testing class structure
    const mockClient = {
      getRequestBranch: () => "main",
      listAllFiles: () => Promise.resolve([]),
      listPublishedFiles: () => Promise.resolve([]),
      searchFiles: () => Promise.resolve([]),
    } as any;
    const cache = new FileCache({ enabled: true, ttl: 1000, maxSize: 100 });
    const normalizer = new PathNormalizer();

    it("should be instantiable without production context", () => {
      const statOps = new StatOperations(mockClient, cache, normalizer);
      assertExists(statOps);
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
      const statOps = new StatOperations(mockClient, cache, normalizer, contextProvider);
      assertExists(statOps);
    });

    it("should have stat method", () => {
      const statOps = new StatOperations(mockClient, cache, normalizer);
      assertExists(statOps.stat);
      assertEquals(typeof statOps.stat, "function");
    });

    it("should have exists method", () => {
      const statOps = new StatOperations(mockClient, cache, normalizer);
      assertExists(statOps.exists);
      assertEquals(typeof statOps.exists, "function");
    });

    it("should have resolveFile method", () => {
      const statOps = new StatOperations(mockClient, cache, normalizer);
      assertExists(statOps.resolveFile);
      assertEquals(typeof statOps.resolveFile, "function");
    });

    it("should have clearIndex method", () => {
      const statOps = new StatOperations(mockClient, cache, normalizer);
      assertExists(statOps.clearIndex);
      assertEquals(typeof statOps.clearIndex, "function");
    });

    it("should have getOriginalApiPath method", () => {
      const statOps = new StatOperations(mockClient, cache, normalizer);
      assertExists(statOps.getOriginalApiPath);
      assertEquals(typeof statOps.getOriginalApiPath, "function");
    });

    it("getOriginalApiPath should return input path when no mapping exists", () => {
      const statOps = new StatOperations(mockClient, cache, normalizer);
      const result = statOps.getOriginalApiPath("test/path.ts");
      assertEquals(result, "test/path.ts");
    });

    it("should be callable to clear index", () => {
      const statOps = new StatOperations(mockClient, cache, normalizer);
      // Should not throw
      statOps.clearIndex();
    });
  });
});
