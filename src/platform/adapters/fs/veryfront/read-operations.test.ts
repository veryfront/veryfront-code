import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontAPIClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { ReadOperations } from "./read-operations.ts";

// deno-lint-ignore no-explicit-any
const createMockClient = (overrides: Record<string, any> = {}): VeryfrontAPIClient =>
  ({
    getRequestBranch: () => "main",
    getFileContent: () => Promise.resolve("file content"),
    getPublishedFileContent: () => Promise.resolve("published content"),
    resolveFileWithExtension: () => Promise.resolve(null),
    ...overrides,
  }) as unknown as VeryfrontAPIClient;

describe("ReadOperations", () => {
  describe("class", () => {
    it("should export ReadOperations class", () => {
      assertExists(ReadOperations);
      assertEquals(typeof ReadOperations, "function");
    });
  });

  describe("instance", () => {
    const mockClient = createMockClient();

    const cache = new FileCache({ enabled: true, ttl: 1000, maxSize: 100 });
    const normalizer = new PathNormalizer();

    const contextProvider = {
      isProductionMode: () => false,
      getReleaseId: () => null,
      getContentContext: () => ({
        sourceType: "branch" as const,
        projectSlug: "test",
        branch: "main",
      }),
    };

    it("should be instantiable without production context", () => {
      const readOps = new ReadOperations(mockClient, cache, normalizer);
      assertExists(readOps);
    });

    it("should be instantiable with content context provider", () => {
      const readOps = new ReadOperations(mockClient, cache, normalizer, contextProvider);
      assertExists(readOps);
    });

    it("should be instantiable with path resolver", () => {
      const pathResolver = (path: string) => path;
      const readOps = new ReadOperations(
        mockClient,
        cache,
        normalizer,
        contextProvider,
        pathResolver,
      );
      assertExists(readOps);
    });

    it("should have readFile method", () => {
      const readOps = new ReadOperations(mockClient, cache, normalizer);
      assertExists(readOps.readFile);
      assertEquals(typeof readOps.readFile, "function");
    });

    it("should have readTextFile method", () => {
      const readOps = new ReadOperations(mockClient, cache, normalizer);
      assertExists(readOps.readTextFile);
      assertEquals(typeof readOps.readTextFile, "function");
    });

    it("should have clearFileListIndex method", () => {
      const readOps = new ReadOperations(mockClient, cache, normalizer);
      assertExists(readOps.clearFileListIndex);
      assertEquals(typeof readOps.clearFileListIndex, "function");
    });

    it("should have setFileListReadyPromise method", () => {
      const readOps = new ReadOperations(mockClient, cache, normalizer);
      assertExists(readOps.setFileListReadyPromise);
      assertEquals(typeof readOps.setFileListReadyPromise, "function");
    });
  });

  describe("cache invalidation", () => {
    const mockClient = createMockClient();
    const cache = new FileCache({ enabled: true, ttl: 1000, maxSize: 100 });
    const normalizer = new PathNormalizer();

    it("should accept isPersistentCacheInvalidated in context provider", () => {
      const contextProvider = {
        isProductionMode: () => true,
        getReleaseId: () => "release-123",
        getContentContext: () => ({
          sourceType: "release" as const,
          projectSlug: "test",
          releaseId: "release-123",
        }),
        isPersistentCacheInvalidated: (prefix: string) => prefix.includes("release-123"),
        isReleaseBeingInvalidated: (releaseId: string) => releaseId === "release-123",
      };

      const readOps = new ReadOperations(mockClient, cache, normalizer, contextProvider);
      assertExists(readOps);
    });

    it("should skip cache when release is being invalidated", () => {
      let invalidatedReleases = new Set<string>();

      const contextProvider = {
        isProductionMode: () => true,
        getReleaseId: () => "release-456",
        getContentContext: () => ({
          sourceType: "release" as const,
          projectSlug: "test-project",
          releaseId: "release-456",
        }),
        isPersistentCacheInvalidated: () => false,
        isReleaseBeingInvalidated: (releaseId: string) => invalidatedReleases.has(releaseId),
      };

      const readOps = new ReadOperations(mockClient, cache, normalizer, contextProvider);
      assertExists(readOps);

      // Simulate marking release as being invalidated
      invalidatedReleases.add("release-456");

      // The contextProvider.isReleaseBeingInvalidated should return true now
      assertEquals(contextProvider.isReleaseBeingInvalidated("release-456"), true);
      assertEquals(contextProvider.isReleaseBeingInvalidated("release-789"), false);

      // Simulate clearing the invalidation
      invalidatedReleases.delete("release-456");
      assertEquals(contextProvider.isReleaseBeingInvalidated("release-456"), false);
    });

    it("should skip cache when prefix is being invalidated", () => {
      let invalidatedPrefixes = new Set<string>();

      const contextProvider = {
        isProductionMode: () => true,
        getReleaseId: () => "release-abc",
        getContentContext: () => ({
          sourceType: "release" as const,
          projectSlug: "my-project",
          releaseId: "release-abc",
        }),
        isPersistentCacheInvalidated: (prefix: string) => {
          for (const pending of invalidatedPrefixes) {
            if (prefix.startsWith(pending) || pending.startsWith(prefix)) return true;
          }
          return false;
        },
        isReleaseBeingInvalidated: () => false,
      };

      const readOps = new ReadOperations(mockClient, cache, normalizer, contextProvider);
      assertExists(readOps);

      // Initially, no prefixes are being invalidated
      assertEquals(
        contextProvider.isPersistentCacheInvalidated("file:release:my-project:release-abc:"),
        false,
      );

      // Simulate marking the prefix as being invalidated
      invalidatedPrefixes.add("file:release:my-project:release-abc:");

      // Now the prefix should be detected as invalidated
      assertEquals(
        contextProvider.isPersistentCacheInvalidated("file:release:my-project:release-abc:"),
        true,
      );

      // More specific path should also match
      assertEquals(
        contextProvider.isPersistentCacheInvalidated(
          "file:release:my-project:release-abc:components/app.tsx",
        ),
        true,
      );

      // Different release should not match
      assertEquals(
        contextProvider.isPersistentCacheInvalidated("file:release:my-project:release-xyz:"),
        false,
      );

      // Clear the invalidation
      invalidatedPrefixes.delete("file:release:my-project:release-abc:");
      assertEquals(
        contextProvider.isPersistentCacheInvalidated("file:release:my-project:release-abc:"),
        false,
      );
    });

    it("should handle environment-based invalidation", () => {
      let invalidatedPrefixes = new Set<string>();

      const contextProvider = {
        isProductionMode: () => true,
        getReleaseId: () => "release-env-123",
        getContentContext: () => ({
          sourceType: "environment" as const,
          projectSlug: "env-project",
          environmentName: "production",
          releaseId: "release-env-123",
        }),
        isPersistentCacheInvalidated: (prefix: string) => {
          for (const pending of invalidatedPrefixes) {
            if (prefix.startsWith(pending) || pending.startsWith(prefix)) return true;
          }
          return false;
        },
        isReleaseBeingInvalidated: () => false,
      };

      const readOps = new ReadOperations(mockClient, cache, normalizer, contextProvider);
      assertExists(readOps);

      // Simulate invalidating both release and environment caches
      invalidatedPrefixes.add("file:release:env-project:release-env-123:");
      invalidatedPrefixes.add("file:env:env-project:production:");

      // Both prefixes should be detected
      assertEquals(
        contextProvider.isPersistentCacheInvalidated("file:release:env-project:release-env-123:"),
        true,
      );
      assertEquals(
        contextProvider.isPersistentCacheInvalidated("file:env:env-project:production:"),
        true,
      );

      // Other environments should not match
      assertEquals(
        contextProvider.isPersistentCacheInvalidated("file:env:env-project:staging:"),
        false,
      );
    });
  });
});
