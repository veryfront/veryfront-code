/**
 * Test: 002.8 CSS Compiler Isolation
 *
 * Validates the fix for issue 002.8 from the architecture audit:
 * - Compiler cache uses LRU with per-stylesheet entries
 * - Vendor plugin state remains encapsulated inside each compiler
 * - Different stylesheets get different compilers
 *
 * @see plans/architecture-audit/002.8-css-compiler-state.md
 */

import "../../../src/html/styles-builder/__tests__/css-processor-setup.ts";
import "../../_helpers/contract-init.ts";
import { assert, assertEquals } from "#veryfront/testing/assert";
import { beforeEach, describe, it } from "#veryfront/testing/bdd";
import {
  generateCSS,
  getCompilerCacheStats,
  invalidateCompiler,
} from "../../../src/html/styles-builder/css-compiler.ts";

describe("002.8 CSS Compiler Isolation", () => {
  beforeEach(() => {
    invalidateCompiler();
  });

  describe("Compiler Cache", () => {
    it("should isolate compilers by exact candidate snapshot", async () => {
      const stylesheet = `@import "tailwindcss";`;

      await generateCSS(stylesheet, ["mt-4"]);
      assertEquals(getCompilerCacheStats().size, 1, "Should have 1 cached compiler");

      await generateCSS(stylesheet, ["mt-8"]);
      assertEquals(getCompilerCacheStats().size, 2, "Should have one compiler per snapshot");
    });

    it("should create separate compilers for different stylesheets", async () => {
      const stylesheetA = `@import "tailwindcss"; @theme { --color-primary: blue; }`;
      const stylesheetB = `@import "tailwindcss"; @theme { --color-primary: red; }`;

      await generateCSS(stylesheetA, ["bg-primary"]);
      await generateCSS(stylesheetB, ["bg-primary"]);

      assertEquals(getCompilerCacheStats().size, 2, "Should have 2 cached compilers");
    });

    it("should have bounded cache size", () => {
      const { maxSize } = getCompilerCacheStats();
      assert(maxSize > 0, "Should have a max cache size");
      assertEquals(maxSize, 10, "Default max size should be 10");
    });

    it("should evict oldest compiler when at capacity", async () => {
      const { maxSize } = getCompilerCacheStats();

      for (let i = 0; i < maxSize + 2; i++) {
        await generateCSS(`@import "tailwindcss"; /* variant ${i} */`, ["mt-4"]);
      }

      assertEquals(getCompilerCacheStats().size, maxSize, "Should not exceed max size");
    });
  });

  describe("Concurrent Safety", () => {
    it("should handle concurrent requests with different stylesheets", async () => {
      const stylesheets = [
        `@import "tailwindcss"; /* concurrent 1 */`,
        `@import "tailwindcss"; /* concurrent 2 */`,
        `@import "tailwindcss"; /* concurrent 3 */`,
      ];

      const results = await Promise.all(
        stylesheets.map((stylesheet) =>
          generateCSS(stylesheet, ["mt-4", "p-2", "text-sm"])
        ),
      );

      for (const { css } of results) {
        assert(css.length > 0, "Should generate CSS");
      }

      assertEquals(getCompilerCacheStats().size, 3, "Should have 3 cached compilers");
    });

    it("should handle concurrent requests with same stylesheet", async () => {
      const stylesheet = `@import "tailwindcss"; /* shared */`;

      const results = await Promise.all(
        Array.from({ length: 10 }, () => generateCSS(stylesheet, ["mt-4"])),
      );

      for (const { css } of results) assert(css.length > 0, "Should generate CSS");

      assertEquals(getCompilerCacheStats().size, 1, "Should reuse single compiler");
    });
  });

  describe("Invalidation", () => {
    it("invalidateCompiler should clear all cached compilers", async () => {
      await generateCSS(`@import "tailwindcss"; /* 1 */`, ["mt-4"]);
      await generateCSS(`@import "tailwindcss"; /* 2 */`, ["mt-4"]);

      assertEquals(getCompilerCacheStats().size, 2);

      invalidateCompiler();

      assertEquals(getCompilerCacheStats().size, 0, "Should clear all compilers");
    });
  });
});
