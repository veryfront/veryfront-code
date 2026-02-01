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

import { assert } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";

async function readPageResolver(): Promise<string> {
  return await Deno.readTextFile("./src/rendering/page-resolution/page-resolver.ts");
}

describe("005.2 SSG App Router Pages Discovery", () => {
  describe("PageResolver Implementation", () => {
    it("should have App Router discovery in getAllPages", async () => {
      const content = await readPageResolver();

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
      const content = await readPageResolver();

      assert(
        content.includes('appDirName = this.config.directories?.app ?? "app"'),
        "Should get app directory name from config",
      );
      assert(
        content.includes("await this.discoverAppRouterPages(appDir"),
        "Should call discoverAppRouterPages for app directory",
      );
      assert(
        content.includes("pagesDirName"),
        "Should still support pages directory",
      );
    });

    it("should handle App Router conventions correctly", async () => {
      const content = await readPageResolver();

      assert(
        content.includes('dirName.startsWith("(")'),
        "Should detect route groups (parentheses)",
      );
      assert(
        content.includes('dirName.startsWith("@")'),
        "Should detect parallel routes (@)",
      );
      assert(
        content.includes('dirName.startsWith("_")'),
        "Should detect private folders (_)",
      );
    });

    it("should convert app directory paths to slugs correctly", async () => {
      const content = await readPageResolver();

      assert(
        content.includes("appDirToSlug"),
        "Should have appDirToSlug function",
      );
      assert(
        content.includes('relativePath === "" ? "/" :'),
        "Should convert empty relative path to root slug",
      );
    });
  });

  describe("Page Pattern Detection", () => {
    it("should match App Router page files", async () => {
      const content = await readPageResolver();

      assert(
        content.includes("^page\\.(mdx|md|tsx|jsx|ts|js)$"),
        "Should have regex pattern for page.* files",
      );
    });
  });
});
