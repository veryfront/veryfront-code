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
  let match;
  while ((match = BUNDLE_RE.exec(code)) !== null) {
    hashes.push(match[2]!);
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
    let tempDir: string;

    async function setupTempDir(): Promise<string> {
      tempDir = await makeTempDir({ prefix: "vf-http-bundle-test-" });
      return tempDir;
    }

    async function cleanupTempDir(): Promise<void> {
      try {
        await remove(tempDir, { recursive: true });
      } catch { /* ignore */ }
    }

    it("returns empty array when all bundles exist on disk", async () => {
      await setupTempDir();
      try {
        await writeTextFile(join(tempDir, "http-111111.mjs"), "export const a = 1;");
        await writeTextFile(join(tempDir, "http-222222.mjs"), "export const b = 2;");

        const failed = await ensureHttpBundlesExist([
          { path: join(tempDir, "http-111111.mjs"), hash: "111111" },
          { path: join(tempDir, "http-222222.mjs"), hash: "222222" },
        ], tempDir);

        assertEquals(failed.length, 0, "All bundles exist on disk, none should fail");
      } finally {
        await cleanupTempDir();
      }
    });

    it("reports missing bundles when no distributed cache available", async () => {
      await setupTempDir();
      try {
        await writeTextFile(join(tempDir, "http-111111.mjs"), "export const a = 1;");

        const failed = await ensureHttpBundlesExist([
          { path: join(tempDir, "http-111111.mjs"), hash: "111111" },
          { path: join(tempDir, "http-aaaaaa.mjs"), hash: "aaaaaa" },
          { path: join(tempDir, "http-bbbbbb.mjs"), hash: "bbbbbb" },
        ], tempDir);

        assertEquals(failed.length, 2, "Two missing bundles should be reported");
        assert(failed.includes("aaaaaa"), "aaaaaa should be in failed list");
        assert(failed.includes("bbbbbb"), "bbbbbb should be in failed list");
      } finally {
        await cleanupTempDir();
      }
    });

    it("handles empty bundle list", async () => {
      await setupTempDir();
      try {
        const failed = await ensureHttpBundlesExist([], tempDir);
        assertEquals(failed.length, 0);
      } finally {
        await cleanupTempDir();
      }
    });

    it("uses canonical paths from cacheDir, ignoring caller-provided paths", async () => {
      await setupTempDir();
      try {
        // Create bundle at canonical path (cacheDir + hash)
        await writeTextFile(join(tempDir, "http-333333.mjs"), "export const c = 3;");

        // Caller provides a path from a different pod's filesystem
        const failed = await ensureHttpBundlesExist([
          { path: "/app/.cache/other-pod-cache/http-333333.mjs", hash: "333333" },
        ], tempDir);

        assertEquals(
          failed.length,
          0,
          "Should find bundle at canonical path regardless of caller path",
        );
      } finally {
        await cleanupTempDir();
      }
    });

    it("reproduces production error: numeric hash 390496888", async () => {
      await setupTempDir();
      try {
        const failed = await ensureHttpBundlesExist([
          { path: "/app/.cache/veryfront-http-bundle/http-390496888.mjs", hash: "390496888" },
        ], tempDir);

        assertEquals(failed.length, 1);
        assertEquals(failed[0], "390496888", "Should correctly identify numeric hash as failed");
      } finally {
        await cleanupTempDir();
      }
    });

    it("deduplicates hashes when same bundle referenced multiple times", async () => {
      await setupTempDir();
      try {
        const failed = await ensureHttpBundlesExist([
          { path: join(tempDir, "http-444444.mjs"), hash: "444444" },
          { path: join(tempDir, "http-444444.mjs"), hash: "444444" },
          { path: join(tempDir, "http-444444.mjs"), hash: "444444" },
        ], tempDir);

        assertEquals(failed.length, 1);
        assertEquals(failed[0], "444444");
      } finally {
        await cleanupTempDir();
      }
    });

    it("detects missing transitive deps in locally-present bundles (plucky-bohr repro)", async () => {
      // Reproduces the production bug: http-725215427.mjs exists locally but
      // imports http-57259823.mjs which does NOT exist. ensureHttpBundlesExist
      // was skipping transitive scanning for already-present bundles, so the
      // missing dep was never discovered until import() failed at runtime.
      const bundleDir = await makeTempDir({ prefix: "vf-veryfront-http-bundle-" });
      try {
        // Bundle A exists locally and imports Bundle B via file:// path
        // The regex requires "veryfront-http-bundle/" in the path
        await writeTextFile(
          join(bundleDir, "http-725215427.mjs"),
          `import { jsx } from "file://${bundleDir}/veryfront-http-bundle/http-57259823.mjs";\nexport default function() { return jsx("div"); }`,
        );
        // Bundle B does NOT exist locally (never created on this pod)

        const failed = await ensureHttpBundlesExist([
          { path: join(bundleDir, "http-725215427.mjs"), hash: "725215427" },
        ], bundleDir);

        // Before fix: failed = [] because 725215427 exists locally, transitive
        // dep 57259823 was never checked, and import() would crash at runtime.
        // After fix: failed = ["57259823"] because the locally-present bundle
        // is scanned for transitive deps, discovering the missing 57259823.
        assert(
          failed.includes("57259823"),
          `Should detect missing transitive dep 57259823, got: [${failed.join(", ")}]`,
        );
      } finally {
        try {
          await remove(bundleDir, { recursive: true });
        } catch { /* ignore */ }
      }
    });

    it("handles mix of existing and missing bundles", async () => {
      await setupTempDir();
      try {
        await writeTextFile(join(tempDir, "http-aaa111.mjs"), "export const exists1 = true;");
        await writeTextFile(join(tempDir, "http-bbb222.mjs"), "export const exists2 = true;");

        const failed = await ensureHttpBundlesExist([
          { path: join(tempDir, "http-aaa111.mjs"), hash: "aaa111" },
          { path: join(tempDir, "http-ccc333.mjs"), hash: "ccc333" }, // missing
          { path: join(tempDir, "http-bbb222.mjs"), hash: "bbb222" },
          { path: join(tempDir, "http-ddd444.mjs"), hash: "ddd444" }, // missing
        ], tempDir);

        assertEquals(failed.length, 2);
        assert(failed.includes("ccc333"));
        assert(failed.includes("ddd444"));
      } finally {
        await cleanupTempDir();
      }
    });
  });
});
