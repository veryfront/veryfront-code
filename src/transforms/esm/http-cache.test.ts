/** @module transforms/esm/http-cache.test */

import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { makeTempDir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { ensureHttpBundlesExist } from "./http-cache.ts";

/** Duplicated from http-cache.ts for isolated unit testing of the pattern. */
const BUNDLE_RE = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-([a-f0-9]+)\.mjs)/gi;

function extractBundleHashes(code: string): string[] {
  const hashes: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = BUNDLE_RE.exec(code)) !== null) {
    hashes.push(match[2]);
  }

  BUNDLE_RE.lastIndex = 0;
  return hashes;
}

describe("HTTP Bundle Cache", { sanitizeResources: false, sanitizeOps: false }, () => {
  describe("HTTP_BUNDLE_PATTERN regex", () => {
    it("matches numeric-only hashes (production repro: 390496888)", () => {
      const code = `import foo from "file:///app/.cache/veryfront-http-bundle/http-390496888.mjs"`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "390496888");
    });

    it("matches hex hashes", () => {
      const code = `import foo from "file:///app/.cache/veryfront-http-bundle/http-a1b2c3d4.mjs"`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "a1b2c3d4");
    });

    it("matches mixed alphanumeric hashes", () => {
      const code = `import foo from "file:///app/.cache/veryfront-http-bundle/http-974671618.mjs"`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "974671618");
    });

    it("extracts multiple bundle references from code", () => {
      const code = [
        `import a from "file:///app/.cache/veryfront-http-bundle/http-111111.mjs";`,
        `import b from "file:///app/.cache/veryfront-http-bundle/http-222222.mjs";`,
        `import c from "file:///app/.cache/veryfront-http-bundle/http-abcdef.mjs";`,
      ].join("\n");
      const hashes = extractBundleHashes(code);
      assertEquals(hashes, ["111111", "222222", "abcdef"]);
    });

    it("does not match non-hex characters (g, h, z)", () => {
      const code = `import foo from "file:///app/.cache/veryfront-http-bundle/http-ghijkl.mjs"`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 0);
    });

    it("handles single-quoted imports", () => {
      const code = `import foo from 'file:///app/.cache/veryfront-http-bundle/http-999999.mjs'`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "999999");
    });

    it("handles dynamic import() syntax", () => {
      const code =
        `const mod = await import("file:///app/.cache/veryfront-http-bundle/http-abc123.mjs")`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "abc123");
    });

    it("handles re-export syntax", () => {
      const code =
        `export { default } from "file:///app/.cache/veryfront-http-bundle/http-def456.mjs"`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "def456");
    });

    it("handles transitive deps in recovered bundle code", () => {
      const bundleCode = [
        `import { createContext } from "file:///app/.cache/veryfront-http-bundle/http-100000.mjs";`,
        `import { useState } from "file:///app/.cache/veryfront-http-bundle/http-200000.mjs";`,
        `export function Component() { return null; }`,
      ].join("\n");
      const hashes = extractBundleHashes(bundleCode);
      assertEquals(hashes, ["100000", "200000"]);
    });
  });

  describe("ensureHttpBundlesExist", () => {
    async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
      const dir = await makeTempDir({ prefix: "vf-http-bundle-test-" });
      try {
        await fn(dir);
      } finally {
        try {
          await remove(dir, { recursive: true });
        } catch {
          /* ignore */
        }
      }
    }

    it("returns empty array when all bundles exist on disk", async () => {
      await withTempDir(async (tempDir) => {
        await writeTextFile(join(tempDir, "http-111111.mjs"), "export const a = 1;");
        await writeTextFile(join(tempDir, "http-222222.mjs"), "export const b = 2;");

        const failed = await ensureHttpBundlesExist(
          [
            { path: join(tempDir, "http-111111.mjs"), hash: "111111" },
            { path: join(tempDir, "http-222222.mjs"), hash: "222222" },
          ],
          tempDir,
        );

        assertEquals(failed.length, 0, "All bundles exist on disk, none should fail");
      });
    });

    it("reports missing bundles when no distributed cache available", async () => {
      await withTempDir(async (tempDir) => {
        await writeTextFile(join(tempDir, "http-111111.mjs"), "export const a = 1;");

        const failed = await ensureHttpBundlesExist(
          [
            { path: join(tempDir, "http-111111.mjs"), hash: "111111" },
            { path: join(tempDir, "http-aaaaaa.mjs"), hash: "aaaaaa" },
            { path: join(tempDir, "http-bbbbbb.mjs"), hash: "bbbbbb" },
          ],
          tempDir,
        );

        assertEquals(failed.length, 2, "Two missing bundles should be reported");
        assert(failed.includes("aaaaaa"), "aaaaaa should be in failed list");
        assert(failed.includes("bbbbbb"), "bbbbbb should be in failed list");
      });
    });

    it("handles empty bundle list", async () => {
      await withTempDir(async (tempDir) => {
        const failed = await ensureHttpBundlesExist([], tempDir);
        assertEquals(failed.length, 0);
      });
    });

    it("uses canonical paths from cacheDir, ignoring caller-provided paths", async () => {
      await withTempDir(async (tempDir) => {
        await writeTextFile(join(tempDir, "http-333333.mjs"), "export const c = 3;");

        const failed = await ensureHttpBundlesExist(
          [{ path: "/app/.cache/other-pod-cache/http-333333.mjs", hash: "333333" }],
          tempDir,
        );

        assertEquals(
          failed.length,
          0,
          "Should find bundle at canonical path regardless of caller path",
        );
      });
    });

    it("reproduces production error: numeric hash 390496888", async () => {
      await withTempDir(async (tempDir) => {
        const failed = await ensureHttpBundlesExist(
          [{ path: "/app/.cache/veryfront-http-bundle/http-390496888.mjs", hash: "390496888" }],
          tempDir,
        );

        assertEquals(failed.length, 1);
        assertEquals(failed[0], "390496888", "Should correctly identify numeric hash as failed");
      });
    });

    it("deduplicates hashes when same bundle referenced multiple times", async () => {
      await withTempDir(async (tempDir) => {
        const failed = await ensureHttpBundlesExist(
          [
            { path: join(tempDir, "http-444444.mjs"), hash: "444444" },
            { path: join(tempDir, "http-444444.mjs"), hash: "444444" },
            { path: join(tempDir, "http-444444.mjs"), hash: "444444" },
          ],
          tempDir,
        );

        assertEquals(failed.length, 1);
        assertEquals(failed[0], "444444");
      });
    });

    it("detects missing transitive deps in locally-present bundles (plucky-bohr repro)", async () => {
      const bundleDir = await makeTempDir({ prefix: "vf-veryfront-http-bundle-" });
      try {
        await writeTextFile(
          join(bundleDir, "http-725215427.mjs"),
          `import { jsx } from "file://${bundleDir}/veryfront-http-bundle/http-57259823.mjs";\nexport default function() { return jsx("div"); }`,
        );

        const failed = await ensureHttpBundlesExist(
          [{ path: join(bundleDir, "http-725215427.mjs"), hash: "725215427" }],
          bundleDir,
        );

        assert(
          failed.includes("57259823"),
          `Should detect missing transitive dep 57259823, got: [${failed.join(", ")}]`,
        );
      } finally {
        try {
          await remove(bundleDir, { recursive: true });
        } catch {
          /* ignore */
        }
      }
    });

    /**
     * This test validates the fix for "Missing HTTP bundles after transform" error.
     *
     * Root cause: When cacheHttpModule loads a bundle from Redis, the cached code
     * might reference child bundles whose Redis keys (code:{hash}, hash:{hash})
     * have expired. Without validation, the parent is written to disk but children
     * can't be recovered, causing the error.
     *
     * The fix: validateBundleDepsExist() is called before using Redis cache.
     * If any deps can't be recovered, we reject the Redis cache and re-fetch
     * from network (which recursively fetches all deps with fresh URLs).
     *
     * This scenario is tested indirectly by ensureHttpBundlesExist tests above,
     * which verify that missing transitive deps are correctly detected.
     */

    it("handles mix of existing and missing bundles", async () => {
      await withTempDir(async (tempDir) => {
        await writeTextFile(join(tempDir, "http-aaa111.mjs"), "export const exists1 = true;");
        await writeTextFile(join(tempDir, "http-bbb222.mjs"), "export const exists2 = true;");

        const failed = await ensureHttpBundlesExist(
          [
            { path: join(tempDir, "http-aaa111.mjs"), hash: "aaa111" },
            { path: join(tempDir, "http-ccc333.mjs"), hash: "ccc333" },
            { path: join(tempDir, "http-bbb222.mjs"), hash: "bbb222" },
            { path: join(tempDir, "http-ddd444.mjs"), hash: "ddd444" },
          ],
          tempDir,
        );

        assertEquals(failed.length, 2);
        assert(failed.includes("ccc333"));
        assert(failed.includes("ddd444"));
      });
    });
  });
});
