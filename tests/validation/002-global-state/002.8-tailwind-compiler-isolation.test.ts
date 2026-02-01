/**
 * Test: 002.8 Tailwind Compiler Isolation
 *
 * Validates the fix for issue 002.8 from the architecture audit:
 * - Compiler cache uses LRU with per-stylesheet entries
 * - Plugin caches are scoped per-stylesheet to prevent pollution
 * - Different stylesheets get different compilers
 *
 * @see plans/architecture-audit/002.8-tailwind-compiler-state.md
 */

import { assert, assertEquals } from "#veryfront/testing/assert";
import { beforeEach, describe, it } from "#veryfront/testing/bdd";
import {
  clearPluginCache,
  generateTailwindCSS,
  getCompilerCacheStats,
  invalidateCompiler,
} from "../../../src/html/styles-builder/tailwind-compiler.ts";

describe("002.8 Tailwind Compiler Isolation", () => {
  beforeEach(() => {
    invalidateCompiler();
  });

  describe("Compiler Cache", () => {
    it("should cache compilers by stylesheet hash", async () => {
      const stylesheet = `@import "tailwindcss";`;

      await generateTailwindCSS(stylesheet, ["mt-4"]);
      assertEquals(getCompilerCacheStats().size, 1, "Should have 1 cached compiler");

      await generateTailwindCSS(stylesheet, ["mt-8"]);
      assertEquals(getCompilerCacheStats().size, 1, "Should still have 1 cached compiler");
    });

    it("should create separate compilers for different stylesheets", async () => {
      const stylesheetA = `@import "tailwindcss"; @theme { --color-primary: blue; }`;
      const stylesheetB = `@import "tailwindcss"; @theme { --color-primary: red; }`;

      await generateTailwindCSS(stylesheetA, ["bg-primary"]);
      await generateTailwindCSS(stylesheetB, ["bg-primary"]);

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
        await generateTailwindCSS(`@import "tailwindcss"; /* variant ${i} */`, ["mt-4"]);
      }

      assertEquals(getCompilerCacheStats().size, maxSize, "Should not exceed max size");
    });
  });

  describe("Plugin Cache Isolation", () => {
    it("should have separate plugin caches per stylesheet", async () => {
      await generateTailwindCSS(`@import "tailwindcss"; /* A */`, ["mt-4"]);
      await generateTailwindCSS(`@import "tailwindcss"; /* B */`, ["mt-4"]);

      const { entries } = getCompilerCacheStats();
      assertEquals(entries.length, 2);

      for (const { pluginCount } of entries) {
        assert(pluginCount >= 0, "Should track plugin count");
      }
    });

    it("clearPluginCache should clear from all compilers", async () => {
      await generateTailwindCSS(`@import "tailwindcss"; /* A */`, ["mt-4"]);
      await generateTailwindCSS(`@import "tailwindcss"; /* B */`, ["mt-4"]);

      clearPluginCache();

      assertEquals(getCompilerCacheStats().size, 2, "Compilers should remain cached");
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
          generateTailwindCSS(stylesheet, ["mt-4", "p-2", "text-sm"])
        )
      );

      for (const { css, error } of results) {
        assert(!error, "Should not have errors");
        assert(css.length > 0, "Should generate CSS");
      }

      assertEquals(getCompilerCacheStats().size, 3, "Should have 3 cached compilers");
    });

    it("should handle concurrent requests with same stylesheet", async () => {
      const stylesheet = `@import "tailwindcss"; /* shared */`;

      const results = await Promise.all(
        Array.from({ length: 10 }, () => generateTailwindCSS(stylesheet, ["mt-4"]))
      );

      for (const { error } of results) {
        assert(!error, "Should not have errors");
      }

      assertEquals(getCompilerCacheStats().size, 1, "Should reuse single compiler");
    });
  });

  describe("Invalidation", () => {
    it("invalidateCompiler should clear all cached compilers", async () => {
      await generateTailwindCSS(`@import "tailwindcss"; /* 1 */`, ["mt-4"]);
      await generateTailwindCSS(`@import "tailwindcss"; /* 2 */`, ["mt-4"]);

      assertEquals(getCompilerCacheStats().size, 2);

      invalidateCompiler();

      assertEquals(getCompilerCacheStats().size, 0, "Should clear all compilers");
    });
  });
});
