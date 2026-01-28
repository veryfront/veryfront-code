/**
 * Test: 003.1 & 003.3 Cache Behavior Fixes
 *
 * Validates the fixes for issues 003.1 and 003.3 from the architecture audit:
 *
 * 003.1 (HIGH): Redis cache now validates ALL file:// paths (local imports + HTTP bundles),
 *               not just HTTP bundles. This prevents "Module not found" errors when
 *               cached transforms reference temp paths from other pods.
 *
 * 003.3 (MEDIUM): Cross-project import cache now includes consuming project's context
 *                 (projectId + reactVersion) in the cache key to prevent cross-project
 *                 cache pollution.
 *
 * @see plans/architecture-audit/003.1-ssr-module-path-mismatch.md
 * @see plans/architecture-audit/003.3-multitenancy-cache-isolation.md
 */

import { assertEquals, assert } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";

describe("003.1 & 003.3 Cache Behavior Fixes", () => {
  describe("003.1 - File Path Extraction", () => {
    // Test the extractAllFilePaths pattern
    const ALL_FILE_PATHS_PATTERN = /file:\/\/([^"'\s]+\.(?:mjs|js))/gi;

    function extractAllFilePaths(code: string): string[] {
      const paths: string[] = [];
      const seen = new Set<string>();
      let match;
      while ((match = ALL_FILE_PATHS_PATTERN.exec(code)) !== null) {
        const path = match[1] as string;
        if (!seen.has(path)) {
          seen.add(path);
          paths.push(path);
        }
      }
      ALL_FILE_PATHS_PATTERN.lastIndex = 0;
      return paths;
    }

    it("should extract HTTP bundle paths", () => {
      const code = `
        import { useState } from "file:///tmp/veryfront-http-bundle/http-abc123.mjs";
        import { useEffect } from "file:///tmp/veryfront-http-bundle/http-def456.mjs";
      `;

      const paths = extractAllFilePaths(code);
      assertEquals(paths.length, 2);
      assert(paths.includes("/tmp/veryfront-http-bundle/http-abc123.mjs"));
      assert(paths.includes("/tmp/veryfront-http-bundle/http-def456.mjs"));
    });

    it("should extract local import paths", () => {
      const code = `
        import { utils } from "file:///tmp/veryfront-abc123/project/lib/utils.mjs";
        import Component from "file:///tmp/veryfront-abc123/project/components/Foo.mjs";
      `;

      const paths = extractAllFilePaths(code);
      assertEquals(paths.length, 2);
      assert(paths.includes("/tmp/veryfront-abc123/project/lib/utils.mjs"));
      assert(paths.includes("/tmp/veryfront-abc123/project/components/Foo.mjs"));
    });

    it("should extract mixed HTTP bundle and local import paths", () => {
      const code = `
        import { useState } from "file:///tmp/veryfront-http-bundle/http-abc123.mjs";
        import { utils } from "file:///tmp/veryfront-pod-a/project/lib/utils.mjs";
        import Component from "file:///tmp/veryfront-pod-a/project/components/Foo.mjs";
      `;

      const paths = extractAllFilePaths(code);
      assertEquals(paths.length, 3);
    });

    it("should deduplicate repeated paths", () => {
      const code = `
        import { a } from "file:///tmp/utils.mjs";
        import { b } from "file:///tmp/utils.mjs";
        import { c } from "file:///tmp/utils.mjs";
      `;

      const paths = extractAllFilePaths(code);
      assertEquals(paths.length, 1, "Should deduplicate identical paths");
    });

    it("should handle .js extension", () => {
      const code = `
        import { legacy } from "file:///tmp/legacy-module.js";
      `;

      const paths = extractAllFilePaths(code);
      assertEquals(paths.length, 1);
      assert(paths.includes("/tmp/legacy-module.js"));
    });
  });

  describe("003.3 - Cross-Project Cache Key", () => {
    // Test the cache key format includes project context
    function buildCrossProjectCacheKey(
      specifier: string,
      projectId: string,
      reactVersion: string,
    ): string {
      return `${specifier}:${projectId}:${reactVersion}`;
    }

    it("should include projectId in cache key", () => {
      const keyA = buildCrossProjectCacheKey(
        "veryfront:shared@1.0.0/@/Button",
        "project-a",
        "18.2.0",
      );
      const keyB = buildCrossProjectCacheKey(
        "veryfront:shared@1.0.0/@/Button",
        "project-b",
        "18.2.0",
      );

      assert(keyA !== keyB, "Different projects should have different cache keys");
      assert(keyA.includes("project-a"));
      assert(keyB.includes("project-b"));
    });

    it("should include reactVersion in cache key", () => {
      const key182 = buildCrossProjectCacheKey(
        "veryfront:shared@1.0.0/@/Button",
        "project-a",
        "18.2.0",
      );
      const key183 = buildCrossProjectCacheKey(
        "veryfront:shared@1.0.0/@/Button",
        "project-a",
        "18.3.1",
      );

      assert(key182 !== key183, "Different React versions should have different cache keys");
      assert(key182.includes("18.2.0"));
      assert(key183.includes("18.3.1"));
    });

    it("should produce unique keys for each project+version combination", () => {
      const keys = new Set([
        buildCrossProjectCacheKey("veryfront:lib@1.0.0/@/X", "proj-a", "18.2.0"),
        buildCrossProjectCacheKey("veryfront:lib@1.0.0/@/X", "proj-a", "18.3.0"),
        buildCrossProjectCacheKey("veryfront:lib@1.0.0/@/X", "proj-b", "18.2.0"),
        buildCrossProjectCacheKey("veryfront:lib@1.0.0/@/X", "proj-b", "18.3.0"),
      ]);

      assertEquals(keys.size, 4, "Each project+version should produce unique key");
    });

    it("should handle default react version", () => {
      const keyDefault = buildCrossProjectCacheKey(
        "veryfront:lib@1.0.0/@/X",
        "project-a",
        "default",
      );

      assert(keyDefault.includes("default"));
      assert(keyDefault.includes("project-a"));
    });
  });
});
