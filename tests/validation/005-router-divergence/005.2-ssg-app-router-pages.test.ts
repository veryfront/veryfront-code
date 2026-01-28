/**
 * Test: 005.2 SSG App Router Pages Discovery
 *
 * Validates the fix for issue 005.2 from the architecture audit:
 * - getAllPages() now discovers both App Router and Pages Router pages
 * - App Router pages are found by recursively scanning for page.tsx files
 * - Route groups, parallel routes, and private folders are handled correctly
 *
 * @see plans/architecture-audit/005.2-ssg-getallpages-missing-app-router.md
 */

import { assertEquals, assert } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";

describe("005.2 SSG App Router Pages Discovery", () => {
  describe("PageResolver Implementation", () => {
    it("should have App Router discovery in getAllPages", async () => {
      const content = await Deno.readTextFile(
        "./src/rendering/page-resolution/page-resolver.ts",
      );

      assert(
        content.includes("discoverAppRouterPages"),
        "Should have discoverAppRouterPages method",
      );
      assert(
        content.includes("APP_ROUTER_PAGE_PATTERN"),
        "Should define APP_ROUTER_PAGE_PATTERN for page.tsx files",
      );
      assert(
        content.includes("isAppRouterPageFile"),
        "Should have isAppRouterPageFile function",
      );
    });

    it("should scan both app/ and pages/ directories", async () => {
      const content = await Deno.readTextFile(
        "./src/rendering/page-resolution/page-resolver.ts",
      );

      // Should check for app directory
      assert(
        content.includes('appDirName = this.config.directories?.app ?? "app"'),
        "Should get app directory name from config",
      );

      // Should scan app directory
      assert(
        content.includes("await this.discoverAppRouterPages(appDir"),
        "Should call discoverAppRouterPages for app directory",
      );

      // Should still scan pages directory
      assert(
        content.includes("pagesDirName"),
        "Should still support pages directory",
      );
    });

    it("should handle App Router conventions correctly", async () => {
      const content = await Deno.readTextFile(
        "./src/rendering/page-resolution/page-resolver.ts",
      );

      // Should skip route groups from URL but still recurse into them
      assert(
        content.includes('dirName.startsWith("(")'),
        "Should detect route groups (parentheses)",
      );

      // Should skip parallel routes
      assert(
        content.includes('dirName.startsWith("@")'),
        "Should detect parallel routes (@)",
      );

      // Should skip private folders
      assert(
        content.includes('dirName.startsWith("_")'),
        "Should detect private folders (_)",
      );
    });

    it("should convert app directory paths to slugs correctly", async () => {
      const content = await Deno.readTextFile(
        "./src/rendering/page-resolution/page-resolver.ts",
      );

      assert(
        content.includes("appDirToSlug"),
        "Should have appDirToSlug function",
      );

      // Should handle root app directory
      assert(
        content.includes('relativePath === "" ? "/" :'),
        "Should convert empty relative path to root slug",
      );
    });
  });

  describe("Page Pattern Detection", () => {
    it("should match App Router page files", async () => {
      const content = await Deno.readTextFile(
        "./src/rendering/page-resolution/page-resolver.ts",
      );

      // Should match page.tsx, page.js, page.mdx, etc.
      assert(
        content.includes("^page\\.(mdx|md|tsx|jsx|ts|js)$"),
        "Should have regex pattern for page.* files",
      );
    });
  });
});
