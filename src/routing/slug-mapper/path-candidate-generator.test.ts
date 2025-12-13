import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  generateAppRouterCandidates,
  generatePagesRouterCandidates,
  getPathCandidates,
  getSupportedExtensions,
} from "./path-candidate-generator.ts";

describe("generateAppRouterCandidates", () => {
  const projectDir = "/project";

  it("should generate candidates for non-empty slug with page files", () => {
    const candidates = generateAppRouterCandidates(projectDir, "about");

    assert(candidates.includes("/project/app/about/page.mdx"));
    assert(candidates.includes("/project/app/about/page.tsx"));
    assert(candidates.includes("/project/app/about/page.jsx"));
    assert(candidates.includes("/project/app/about/page.ts"));
    assert(candidates.includes("/project/app/about/page.js"));
  });

  it("should generate candidates for non-empty slug with direct files", () => {
    const candidates = generateAppRouterCandidates(projectDir, "about");

    assert(candidates.includes("/project/app/about.mdx"));
    assert(candidates.includes("/project/app/about.tsx"));
    assert(candidates.includes("/project/app/about.jsx"));
    assert(candidates.includes("/project/app/about.ts"));
    assert(candidates.includes("/project/app/about.js"));
  });

  it("should generate root candidates for empty slug", () => {
    const candidates = generateAppRouterCandidates(projectDir, "");

    assert(candidates.includes("/project/app/page.mdx"));
    assert(candidates.includes("/project/app/page.tsx"));
    assert(candidates.includes("/project/app/page.jsx"));
    assert(candidates.includes("/project/app/page.ts"));
    assert(candidates.includes("/project/app/page.js"));
  });

  it("should handle nested paths", () => {
    const candidates = generateAppRouterCandidates(projectDir, "blog/posts");

    assert(candidates.includes("/project/app/blog/posts/page.mdx"));
    assert(candidates.includes("/project/app/blog/posts.mdx"));
  });

  it("should generate all extensions", () => {
    const candidates = generateAppRouterCandidates(projectDir, "test");

    const extensions = [".mdx", ".tsx", ".jsx", ".ts", ".js"];
    for (const ext of extensions) {
      const hasExtension = candidates.some((c) => c.endsWith(ext));
      assertEquals(hasExtension, true, `Should include ${ext}`);
    }
  });
});

describe("generatePagesRouterCandidates", () => {
  const projectDir = "/project";

  describe("root/index paths", () => {
    it("should generate index candidates for empty slug", () => {
      const candidates = generatePagesRouterCandidates(projectDir, "");

      assert(candidates.includes("/project/pages/index.mdx"));
      assert(candidates.includes("/project/pages/index.tsx"));
      assert(candidates.includes("/project/index.mdx"));
      assert(candidates.includes("/project/index.tsx"));
    });

    it("should generate index candidates for 'index' slug", () => {
      const candidates = generatePagesRouterCandidates(projectDir, "index");

      assert(candidates.includes("/project/pages/index.mdx"));
      assert(candidates.includes("/project/index.mdx"));
    });
  });

  describe("regular paths", () => {
    it("should generate direct file candidates", () => {
      const candidates = generatePagesRouterCandidates(projectDir, "about");

      assert(candidates.includes("/project/pages/about.mdx"));
      assert(candidates.includes("/project/pages/about.tsx"));
      assert(candidates.includes("/project/about.mdx"));
    });

    it("should generate index file candidates", () => {
      const candidates = generatePagesRouterCandidates(projectDir, "about");

      assert(candidates.includes("/project/pages/about/index.mdx"));
      assert(candidates.includes("/project/pages/about/index.tsx"));
    });

    it("should handle nested paths", () => {
      const candidates = generatePagesRouterCandidates(projectDir, "blog/posts");

      assert(candidates.includes("/project/pages/blog/posts.mdx"));
      assert(candidates.includes("/project/pages/blog/posts/index.mdx"));
      assert(candidates.includes("/project/blog/posts.mdx"));
    });
  });

  it("should generate all extensions", () => {
    const candidates = generatePagesRouterCandidates(projectDir, "test");

    const extensions = [".mdx", ".tsx", ".jsx", ".ts", ".js"];
    for (const ext of extensions) {
      const hasExtension = candidates.some((c) => c.endsWith(ext));
      assertEquals(hasExtension, true, `Should include ${ext}`);
    }
  });
});

describe("getPathCandidates", () => {
  const projectDir = "/project";

  it("should return both app and pages router candidates", () => {
    const candidates = getPathCandidates(projectDir, "about");

    assertEquals(Array.isArray(candidates.appRouter), true);
    assertEquals(Array.isArray(candidates.pagesRouter), true);
    assertEquals(candidates.appRouter.length > 0, true);
    assertEquals(candidates.pagesRouter.length > 0, true);
  });

  it("should handle empty slug", () => {
    const candidates = getPathCandidates(projectDir, "");

    assertEquals(candidates.appRouter.length > 0, true);
    assertEquals(candidates.pagesRouter.length > 0, true);
  });

  it("should handle nested paths", () => {
    const candidates = getPathCandidates(projectDir, "blog/posts/123");

    assert(candidates.appRouter.some((c) => c.includes("blog/posts/123")));
    assert(candidates.pagesRouter.some((c) => c.includes("blog/posts/123")));
  });

  it("should generate different candidates for app vs pages router", () => {
    const candidates = getPathCandidates(projectDir, "about");

    const hasAppPage = candidates.appRouter.some((c) => c.includes("/page."));
    const hasPagesIndex = candidates.pagesRouter.some((c) => c.includes("/index."));

    assertEquals(hasAppPage, true);
    assertEquals(hasPagesIndex, true);
  });

  it("should normalize slug", () => {
    const candidates = getPathCandidates(projectDir, "");

    // Empty string should be handled correctly
    assertEquals(candidates.appRouter.length > 0, true);
    assertEquals(candidates.pagesRouter.length > 0, true);
  });
});

describe("getSupportedExtensions", () => {
  it("should return array of extensions", () => {
    const extensions = getSupportedExtensions();

    assertEquals(Array.isArray(extensions), true);
    assertEquals(extensions.length > 0, true);
  });

  it("should include all standard extensions", () => {
    const extensions = getSupportedExtensions();

    assert(extensions.includes(".mdx"));
    assert(extensions.includes(".tsx"));
    assert(extensions.includes(".jsx"));
    assert(extensions.includes(".ts"));
    assert(extensions.includes(".js"));
  });

  it("should return copy of extensions array", () => {
    const extensions1 = getSupportedExtensions();
    const extensions2 = getSupportedExtensions();

    // Should be different array instances
    assertEquals(extensions1 === extensions2, false);
    // But should have same content
    assertEquals(extensions1.length, extensions2.length);
  });

  it("should have extensions starting with dot", () => {
    const extensions = getSupportedExtensions();

    for (const ext of extensions) {
      assertEquals(ext.startsWith("."), true);
    }
  });
});

describe("integration tests", () => {
  it("should generate reasonable number of candidates", () => {
    const projectDir = "/project";
    const candidates = getPathCandidates(projectDir, "about");

    // Should have multiple candidates for each router type
    assertEquals(candidates.appRouter.length >= 5, true);
    assertEquals(candidates.pagesRouter.length >= 5, true);
  });

  it("should prioritize common patterns", () => {
    const projectDir = "/project";
    const candidates = getPathCandidates(projectDir, "about");

    // App router should check page files first
    const firstAppCandidate = candidates.appRouter[0];
    assert(firstAppCandidate?.includes("/page."));

    // Pages router should check direct files
    const firstPagesCandidate = candidates.pagesRouter[0];
    assert(firstPagesCandidate !== undefined);
  });

  it("should handle special characters in slug", () => {
    const projectDir = "/project";
    const candidates = getPathCandidates(projectDir, "blog-posts");

    assert(candidates.appRouter.some((c) => c.includes("blog-posts")));
    assert(candidates.pagesRouter.some((c) => c.includes("blog-posts")));
  });

  it("should handle deep nesting", () => {
    const projectDir = "/project";
    const candidates = getPathCandidates(projectDir, "a/b/c/d");

    assert(candidates.appRouter.some((c) => c.includes("a/b/c/d")));
    assert(candidates.pagesRouter.some((c) => c.includes("a/b/c/d")));
  });
});
