import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildDirCacheKeyPrefix,
  buildFileCacheKeyPrefix,
  buildFileListCacheKey,
  buildStatCacheKeyPrefix,
} from "./cache-keys.ts";

const branchCtx = {
  sourceType: "branch" as const,
  projectSlug: "my-project",
  branch: "main",
  releaseId: null,
  environmentName: null,
};

const releaseCtx = {
  sourceType: "release" as const,
  projectSlug: "my-project",
  branch: null,
  releaseId: "rel-123",
  environmentName: null,
};

const envCtx = {
  sourceType: "environment" as const,
  projectSlug: "my-project",
  branch: null,
  releaseId: "rel-456",
  environmentName: "production",
};

describe("cache-keys", () => {
  describe("buildFileCacheKeyPrefix", () => {
    it("should return file:unknown for null context", () => {
      assertEquals(buildFileCacheKeyPrefix(null), "file:unknown");
    });

    it("should return file:unknown for undefined context", () => {
      assertEquals(buildFileCacheKeyPrefix(undefined), "file:unknown");
    });

    it("should build branch-based key", () => {
      const result = buildFileCacheKeyPrefix(branchCtx);
      assertEquals(result, "file:branch:my-project:main");
    });

    it("should build release-based key", () => {
      const result = buildFileCacheKeyPrefix(releaseCtx);
      assertEquals(result, "file:release:my-project:rel-123");
    });

    it("should build environment-based key", () => {
      const result = buildFileCacheKeyPrefix(envCtx);
      assertEquals(result, "file:env:my-project:production:rel-456");
    });
  });

  describe("buildStatCacheKeyPrefix", () => {
    it("should return stat:unknown for null context", () => {
      assertEquals(buildStatCacheKeyPrefix(null), "stat:unknown");
    });

    it("should build branch-based key", () => {
      const result = buildStatCacheKeyPrefix(branchCtx);
      assertEquals(result, "stat:branch:my-project:main");
    });

    it("should build release-based key", () => {
      const result = buildStatCacheKeyPrefix(releaseCtx);
      assertEquals(result, "stat:release:my-project:rel-123");
    });
  });

  describe("buildDirCacheKeyPrefix", () => {
    it("should return dir:unknown for null context", () => {
      assertEquals(buildDirCacheKeyPrefix(null), "dir:unknown");
    });

    it("should build branch-based key", () => {
      const result = buildDirCacheKeyPrefix(branchCtx);
      assertEquals(result, "dir:branch:my-project:main");
    });
  });

  describe("buildFileListCacheKey", () => {
    it("should return files:unknown for null context", () => {
      assertEquals(buildFileListCacheKey(null), "files:unknown");
    });

    it("should build branch-based key", () => {
      const result = buildFileListCacheKey(branchCtx);
      assertEquals(result, "files:branch:my-project:main");
    });

    it("should build environment-based key", () => {
      const result = buildFileListCacheKey(envCtx);
      assertEquals(result, "files:env:my-project:production:rel-456");
    });
  });
});
