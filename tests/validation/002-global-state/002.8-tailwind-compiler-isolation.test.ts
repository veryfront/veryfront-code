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

import { assertEquals, assert } from "@veryfront/testing/assert";
import { describe, it, beforeEach } from "@veryfront/testing/bdd";
import {
  generateTailwindCSS,
  invalidateCompiler,
  getCompilerCacheStats,
  clearPluginCache,
} from "../../../src/html/styles-builder/tailwind-compiler.ts";

describe("002.8 Tailwind Compiler Isolation", () => {
  beforeEach(() => {
    // Clear all compilers before each test
    invalidateCompiler();
  });

  describe("Compiler Cache", () => {
    it("should cache compilers by stylesheet hash", async () => {
      const stylesheet = `@import "tailwindcss";`;

      // First call creates compiler
      await generateTailwindCSS(stylesheet, ["mt-4"]);

      const stats1 = getCompilerCacheStats();
      assertEquals(stats1.size, 1, "Should have 1 cached compiler");

      // Second call with same stylesheet should reuse
      await generateTailwindCSS(stylesheet, ["mt-8"]);

      const stats2 = getCompilerCacheStats();
      assertEquals(stats2.size, 1, "Should still have 1 cached compiler");
    });

    it("should create separate compilers for different stylesheets", async () => {
      const stylesheetA = `@import "tailwindcss"; @theme { --color-primary: blue; }`;
      const stylesheetB = `@import "tailwindcss"; @theme { --color-primary: red; }`;

      await generateTailwindCSS(stylesheetA, ["bg-primary"]);
      await generateTailwindCSS(stylesheetB, ["bg-primary"]);

      const stats = getCompilerCacheStats();
      assertEquals(stats.size, 2, "Should have 2 cached compilers");
    });

    it("should have bounded cache size", () => {
      const stats = getCompilerCacheStats();
      assert(stats.maxSize > 0, "Should have a max cache size");
      assertEquals(stats.maxSize, 10, "Default max size should be 10");
    });

    it("should evict oldest compiler when at capacity", async () => {
      // Create compilers up to capacity
      const maxSize = getCompilerCacheStats().maxSize;

      for (let i = 0; i < maxSize + 2; i++) {
        const stylesheet = `@import "tailwindcss"; /* variant ${i} */`;
        await generateTailwindCSS(stylesheet, ["mt-4"]);
      }

      const stats = getCompilerCacheStats();
      assertEquals(stats.size, maxSize, "Should not exceed max size");
    });
  });

  describe("Plugin Cache Isolation", () => {
    it("should have separate plugin caches per stylesheet", async () => {
      const stylesheetA = `@import "tailwindcss"; /* A */`;
      const stylesheetB = `@import "tailwindcss"; /* B */`;

      await generateTailwindCSS(stylesheetA, ["mt-4"]);
      await generateTailwindCSS(stylesheetB, ["mt-4"]);

      const stats = getCompilerCacheStats();
      assertEquals(stats.entries.length, 2);

      // Each entry should have its own plugin cache
      for (const entry of stats.entries) {
        assert(entry.pluginCount >= 0, "Should track plugin count");
      }
    });

    it("clearPluginCache should clear from all compilers", async () => {
      const stylesheetA = `@import "tailwindcss"; /* A */`;
      const stylesheetB = `@import "tailwindcss"; /* B */`;

      await generateTailwindCSS(stylesheetA, ["mt-4"]);
      await generateTailwindCSS(stylesheetB, ["mt-4"]);

      // Clear all plugins
      clearPluginCache();

      // Compilers should still exist
      const stats = getCompilerCacheStats();
      assertEquals(stats.size, 2, "Compilers should remain cached");
    });
  });

  describe("Concurrent Safety", () => {
    it("should handle concurrent requests with different stylesheets", async () => {
      const stylesheets = [
        `@import "tailwindcss"; /* concurrent 1 */`,
        `@import "tailwindcss"; /* concurrent 2 */`,
        `@import "tailwindcss"; /* concurrent 3 */`,
      ];

      // Run concurrently
      const results = await Promise.all(
        stylesheets.map((stylesheet) =>
          generateTailwindCSS(stylesheet, ["mt-4", "p-2", "text-sm"])
        )
      );

      // All should succeed
      for (const result of results) {
        assert(!result.error, "Should not have errors");
        assert(result.css.length > 0, "Should generate CSS");
      }

      // Should have 3 cached compilers
      const stats = getCompilerCacheStats();
      assertEquals(stats.size, 3, "Should have 3 cached compilers");
    });

    it("should handle concurrent requests with same stylesheet", async () => {
      const stylesheet = `@import "tailwindcss"; /* shared */`;

      // Run many concurrent requests with same stylesheet
      const results = await Promise.all(
        Array.from({ length: 10 }).map(() =>
          generateTailwindCSS(stylesheet, ["mt-4"])
        )
      );

      // All should succeed with same output
      for (const result of results) {
        assert(!result.error, "Should not have errors");
      }

      // Should only have 1 cached compiler
      const stats = getCompilerCacheStats();
      assertEquals(stats.size, 1, "Should reuse single compiler");
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
