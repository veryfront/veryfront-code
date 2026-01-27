/** @module transforms/esm/http-cache.test */

import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { makeTempDir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { ensureHttpBundlesExist, isValidJavaScriptContent } from "./http-cache.ts";

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

  describe("isValidJavaScriptContent", () => {
    it("returns false for empty content", () => {
      assertEquals(isValidJavaScriptContent(""), false);
      assertEquals(isValidJavaScriptContent(null as unknown as string), false);
      assertEquals(isValidJavaScriptContent(undefined as unknown as string), false);
    });

    it("returns false for gzip-prefixed content", () => {
      assertEquals(isValidJavaScriptContent("gz:H4sIAAAAAAAAA9V9a3PjNpbo9/0V..."), false);
    });

    it("returns false for gzip magic bytes", () => {
      assertEquals(isValidJavaScriptContent("\x1f\x8bsome compressed data"), false);
    });

    it("returns false for base64-like content without JS syntax", () => {
      const base64Content = "EWCywNRqfIyaIfSVOss+2FYfTQ0shWI5ECSdlRZf33BSXZsZ24N7bEj+HMO8OH1NvzEdqC2eXoYqTwyV".repeat(5);
      assertEquals(isValidJavaScriptContent(base64Content), false);
    });

    it("returns true for valid import statements", () => {
      assertEquals(isValidJavaScriptContent('import foo from "bar";'), true);
      assertEquals(isValidJavaScriptContent("import { a, b } from './module';"), true);
    });

    it("returns true for valid export statements", () => {
      assertEquals(isValidJavaScriptContent("export const foo = 1;"), true);
      assertEquals(isValidJavaScriptContent("export default function() {}"), true);
    });

    it("returns true for valid function declarations", () => {
      assertEquals(isValidJavaScriptContent("function foo() { return 1; }"), true);
      assertEquals(isValidJavaScriptContent("async function bar() { await fetch(); }"), true);
    });

    it("returns true for valid const/let/var declarations", () => {
      assertEquals(isValidJavaScriptContent("const x = 1;"), true);
      assertEquals(isValidJavaScriptContent("let y = 2;"), true);
      assertEquals(isValidJavaScriptContent("var z = 3;"), true);
    });

    it("returns true for valid class declarations", () => {
      assertEquals(isValidJavaScriptContent("class Foo { constructor() {} }"), true);
    });

    it("returns true for content starting with comments", () => {
      assertEquals(isValidJavaScriptContent("// comment\nconst x = 1;"), true);
      assertEquals(isValidJavaScriptContent("/* block */\nexport default {};"), true);
    });

    it("returns true for use strict", () => {
      assertEquals(isValidJavaScriptContent('"use strict";\nconst x = 1;'), true);
      assertEquals(isValidJavaScriptContent("'use strict';\nconst x = 1;"), true);
    });

    it("returns true for IIFE patterns", () => {
      assertEquals(isValidJavaScriptContent("(function() { return 1; })();"), true);
      assertEquals(isValidJavaScriptContent("(() => 1)();"), true);
    });

    it("returns true for object/block patterns", () => {
      assertEquals(isValidJavaScriptContent("{ const x = 1; }"), true);
    });

    it("returns true for content with JS syntax chars even with unusual start", () => {
      // Content that doesn't start with common patterns but has JS syntax
      assertEquals(isValidJavaScriptContent("_internal = function() {};"), true);
    });
  });
});
