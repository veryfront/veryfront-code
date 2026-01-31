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
  releaseId: undefined,
  environmentName: undefined,
};

const releaseCtx = {
  sourceType: "release" as const,
  projectSlug: "my-project",
  branch: undefined,
  releaseId: "rel-123",
  environmentName: undefined,
};

const envCtx = {
  sourceType: "environment" as const,
  projectSlug: "my-project",
  branch: undefined,
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
      assertEquals(
        buildFileCacheKeyPrefix(branchCtx),
        "file:branch:my-project:main",
      );
    });

    it("should build release-based key", () => {
      assertEquals(
        buildFileCacheKeyPrefix(releaseCtx),
        "file:release:my-project:rel-123",
      );
    });

    it("should build environment-based key", () => {
      assertEquals(
        buildFileCacheKeyPrefix(envCtx),
        "file:env:my-project:production:rel-456",
      );
    });
  });

  describe("buildStatCacheKeyPrefix", () => {
    it("should return stat:unknown for null context", () => {
      assertEquals(buildStatCacheKeyPrefix(null), "stat:unknown");
    });

    it("should build branch-based key", () => {
      assertEquals(
        buildStatCacheKeyPrefix(branchCtx),
        "stat:branch:my-project:main",
      );
    });

    it("should build release-based key", () => {
      assertEquals(
        buildStatCacheKeyPrefix(releaseCtx),
        "stat:release:my-project:rel-123",
      );
    });
  });

  describe("buildDirCacheKeyPrefix", () => {
    it("should return dir:unknown for null context", () => {
      assertEquals(buildDirCacheKeyPrefix(null), "dir:unknown");
    });

    it("should build branch-based key", () => {
      assertEquals(
        buildDirCacheKeyPrefix(branchCtx),
        "dir:branch:my-project:main",
      );
    });
  });

  describe("buildFileListCacheKey", () => {
    it("should return files:unknown for null context", () => {
      assertEquals(buildFileListCacheKey(null), "files:unknown");
    });

    it("should build branch-based key", () => {
      assertEquals(
        buildFileListCacheKey(branchCtx),
        "files:branch:my-project:main",
      );
    });

    it("should build environment-based key", () => {
      assertEquals(
        buildFileListCacheKey(envCtx),
        "files:env:my-project:production:rel-456",
      );
    });
  });
});
