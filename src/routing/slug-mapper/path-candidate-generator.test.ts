import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  generateAppRouterCandidates,
  generatePagesRouterCandidates,
  getPathCandidates,
  getSupportedExtensions,
} from "./path-candidate-generator.ts";

describe("path-candidate-generator", () => {
  describe("generateAppRouterCandidates", () => {
    it("should generate candidates for root path", () => {
      const candidates = generateAppRouterCandidates("/project", "");

      assertEquals(candidates.some((c) => c.endsWith("/app/page.tsx")), true);
      assertEquals(candidates.some((c) => c.endsWith("/app/page.mdx")), true);
    });

    it("should generate candidates for nested path", () => {
      const candidates = generateAppRouterCandidates("/project", "about");

      assertEquals(candidates.some((c) => c.includes("/app/about/page.tsx")), true);
      assertEquals(candidates.some((c) => c.includes("/app/about.tsx")), true);
    });

    it("should generate candidates with all supported extensions", () => {
      const candidates = generateAppRouterCandidates("/project", "test");
      const extensions = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"];

      for (const ext of extensions) {
        assertEquals(candidates.some((c) => c.endsWith(ext)), true);
      }
    });
  });

  describe("generatePagesRouterCandidates", () => {
    it("should generate candidates for index path", () => {
      const candidates = generatePagesRouterCandidates("/project", "");

      assertEquals(candidates.some((c) => c.includes("/pages/index")), true);
    });

    it("should generate candidates for nested path", () => {
      const candidates = generatePagesRouterCandidates("/project", "about");

      assertEquals(candidates.some((c) => c.includes("/pages/about")), true);
    });

    it("should also try project root for pages", () => {
      const candidates = generatePagesRouterCandidates("/project", "custom");

      assertEquals(candidates.some((c) => c.includes("/pages/custom")), true);
      assertEquals(candidates.some((c) => c.match(/\/project\/custom\.[a-z]+$/)), true);
    });

    it("should try index.tsx in subdirectory", () => {
      const candidates = generatePagesRouterCandidates("/project", "blog");

      assertEquals(candidates.some((c) => c.includes("/pages/blog/index")), true);
    });
  });

  describe("getPathCandidates", () => {
    it("should return both app and pages router candidates", () => {
      const result = getPathCandidates("/project", "about");

      assertEquals(result.appRouter.length > 0, true);
      assertEquals(result.pagesRouter.length > 0, true);
    });

    it("should normalize empty slug", () => {
      const result = getPathCandidates("/project", "");

      assertEquals(result.appRouter.length > 0, true);
      assertEquals(result.pagesRouter.length > 0, true);
    });
  });

  describe("getSupportedExtensions", () => {
    it("should return array of extensions", () => {
      const extensions = getSupportedExtensions();

      assertEquals(Array.isArray(extensions), true);
      assertEquals(extensions.length > 0, true);
      assertEquals(extensions.includes(".tsx"), true);
      assertEquals(extensions.includes(".mdx"), true);
    });

    it("should return a copy to prevent mutation", () => {
      const ext1 = getSupportedExtensions();
      const ext2 = getSupportedExtensions();

      ext1.push(".custom");
      assertEquals(ext2.includes(".custom"), false);
    });
  });
});
