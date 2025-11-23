/**
 * Loader Utils Tests
 *
 * Comprehensive tests for loader utility functions covering:
 * - File extension to esbuild loader mapping
 * - File type detection
 * - Slug generation from file paths
 * - Edge cases and error handling
 */

import { assertEquals } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { getFileType, getLoaderFromPath, getSlugFromPath } from "./loader-utils.ts";

describe("Loader Utils", () => {
  describe("getLoaderFromPath", () => {
    it("returns ts loader for .ts files", () => {
      const loader = getLoaderFromPath("/src/components/Button.ts");
      assertEquals(loader, "ts");
    });

    it("returns tsx loader for .tsx files", () => {
      const loader = getLoaderFromPath("/src/components/Button.tsx");
      assertEquals(loader, "tsx");
    });

    it("returns js loader for .js files", () => {
      const loader = getLoaderFromPath("/src/utils/helpers.js");
      assertEquals(loader, "js");
    });

    it("returns js loader for .mjs files", () => {
      const loader = getLoaderFromPath("/src/utils/helpers.mjs");
      assertEquals(loader, "js");
    });

    it("returns jsx loader for .jsx files", () => {
      const loader = getLoaderFromPath("/src/components/Button.jsx");
      assertEquals(loader, "jsx");
    });

    it("returns json loader for .json files", () => {
      const loader = getLoaderFromPath("/config/settings.json");
      assertEquals(loader, "json");
    });

    it("returns css loader for .css files", () => {
      const loader = getLoaderFromPath("/styles/main.css");
      assertEquals(loader, "css");
    });

    it("returns tsx loader for .mdx files", () => {
      const loader = getLoaderFromPath("/content/article.mdx");
      assertEquals(loader, "tsx");
    });

    it("returns default loader for unknown extensions", () => {
      const loader = getLoaderFromPath("/data/file.txt");
      assertEquals(loader, "default");
    });

    it("handles uppercase extensions", () => {
      const loader = getLoaderFromPath("/src/Component.TSX");
      assertEquals(loader, "tsx");
    });

    it("handles mixed case extensions", () => {
      const loader = getLoaderFromPath("/src/Component.Jsx");
      assertEquals(loader, "jsx");
    });

    it("handles files with multiple dots", () => {
      const loader = getLoaderFromPath("/src/components/Button.spec.ts");
      assertEquals(loader, "ts");
    });

    it("handles files without extensions", () => {
      const loader = getLoaderFromPath("/src/components/Button");
      assertEquals(loader, "default");
    });
  });

  describe("getFileType", () => {
    it("returns mdx for .mdx files", () => {
      const type = getFileType("/content/article.mdx");
      assertEquals(type, "mdx");
    });

    it("returns tsx for .tsx files", () => {
      const type = getFileType("/src/components/Button.tsx");
      assertEquals(type, "tsx");
    });

    it("returns ts for .ts files", () => {
      const type = getFileType("/src/utils/helpers.ts");
      assertEquals(type, "ts");
    });

    it("returns jsx for .jsx files", () => {
      const type = getFileType("/src/components/Button.jsx");
      assertEquals(type, "jsx");
    });

    it("returns js for .js files", () => {
      const type = getFileType("/src/utils/helpers.js");
      assertEquals(type, "js");
    });

    it("returns js for .mjs files", () => {
      const type = getFileType("/src/utils/helpers.mjs");
      assertEquals(type, "js");
    });

    it("returns css for .css files", () => {
      const type = getFileType("/styles/main.css");
      assertEquals(type, "css");
    });

    it("returns json for .json files", () => {
      const type = getFileType("/config/settings.json");
      assertEquals(type, "json");
    });

    it("returns js for unknown extensions (default)", () => {
      const type = getFileType("/data/file.txt");
      assertEquals(type, "js");
    });

    it("handles uppercase extensions", () => {
      const type = getFileType("/src/Component.MDX");
      assertEquals(type, "mdx");
    });

    it("handles files with multiple dots", () => {
      const type = getFileType("/src/components/Button.test.tsx");
      assertEquals(type, "tsx");
    });
  });

  describe("getSlugFromPath", () => {
    it("removes file extensions", () => {
      const slug = getSlugFromPath("./pages/about.tsx");
      assertEquals(slug, "pages/about");
    });

    it("removes leading ./ prefix", () => {
      const slug = getSlugFromPath("./pages/contact.ts");
      assertEquals(slug, "pages/contact");
    });

    it("removes /index suffix", () => {
      const slug = getSlugFromPath("./pages/index.tsx");
      assertEquals(slug, "pages");
    });

    it("handles nested index files", () => {
      const slug = getSlugFromPath("./pages/blog/index.tsx");
      assertEquals(slug, "pages/blog");
    });

    it("converts to lowercase", () => {
      const slug = getSlugFromPath("./pages/AboutUs.tsx");
      assertEquals(slug, "pages/aboutus");
    });

    it("replaces special characters with dashes", () => {
      const slug = getSlugFromPath("./pages/my page!.tsx");
      assertEquals(slug, "pages/my-page-");
    });

    it("handles multiple special characters", () => {
      const slug = getSlugFromPath("./pages/hello@world#test.tsx");
      assertEquals(slug, "pages/hello-world-test");
    });

    it("preserves hyphens in filenames", () => {
      const slug = getSlugFromPath("./pages/about-us.tsx");
      assertEquals(slug, "pages/about-us");
    });

    it("preserves forward slashes in paths", () => {
      const slug = getSlugFromPath("./pages/blog/posts/first.tsx");
      assertEquals(slug, "pages/blog/posts/first");
    });

    it("handles paths without ./ prefix", () => {
      const slug = getSlugFromPath("pages/about.tsx");
      assertEquals(slug, "pages/about");
    });

    it("handles .mdx files", () => {
      const slug = getSlugFromPath("./content/article.mdx");
      assertEquals(slug, "content/article");
    });

    it("handles .jsx files", () => {
      const slug = getSlugFromPath("./components/Button.jsx");
      assertEquals(slug, "components/button");
    });

    it("handles .js files", () => {
      const slug = getSlugFromPath("./utils/helpers.js");
      assertEquals(slug, "utils/helpers");
    });

    it("handles complex paths with multiple transformations", () => {
      const slug = getSlugFromPath("./pages/Blog Post #1!/index.tsx");
      assertEquals(slug, "pages/blog-post--1-");
    });

    it("handles empty path components", () => {
      const slug = getSlugFromPath("./pages//about.tsx");
      assertEquals(slug, "pages//about");
    });

    it("handles root index file", () => {
      const slug = getSlugFromPath("./index.tsx");
      assertEquals(slug, "index");
    });
  });
});
