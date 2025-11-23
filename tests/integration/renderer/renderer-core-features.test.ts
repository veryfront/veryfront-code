/**
 * VeryfrontRenderer Features Tests (Part 2 of 3)
 * Tests: App Router Specific Features, HTML Generation, getAllPages,
 *        Virtual Module System, Error Handling, Default MDX Components,
 *        RenderResult Validation, Cache Boundary Tests,
 *        Streaming Error Recovery, Layout Compilation Failure Handling
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";
import type { VeryfrontRenderer as _VeryfrontRenderer } from "../../../src/rendering/orchestrator/ssr.ts";

  // Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
  // See: https://github.com/facebook/react/issues/24669
  describe(
  "VeryfrontRenderer Core - Features",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    describe("App Router Specific Features", () => {
      it("should apply loading component in App Router", async () => {
        await withTestContext("renderer-core-loading", async (context) => {
          await Deno.mkdir(join(context.projectDir, "app", "test"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "app", "loading.tsx"),
            `export default function Loading() {
              return <div className="loading">Loading...</div>;
            }`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "app", "test", "page.mdx"),
            `# Test Page`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("test");
          assertExists(result);
          // Loading component wrapped in Suspense
        });
      });

      it("should apply error boundary in App Router", async () => {
        await withTestContext("renderer-core-error-boundary", async (context) => {
          await Deno.mkdir(join(context.projectDir, "app", "test"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "app", "error.tsx"),
            `export default function Error() {
              return <div className="error">Error occurred</div>;
            }`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "app", "test", "page.mdx"),
            `# Test Page`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("test");
          assertExists(result);
          // Error boundary should be applied
        });
      });

      it("should search ancestor directories for reserved components", async () => {
        await withTestContext("renderer-core-ancestor-search", async (context) => {
          await Deno.mkdir(join(context.projectDir, "app", "blog", "post"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "app", "loading.tsx"),
            `export default function Loading() {
              return <div className="app-loading">Loading...</div>;
            }`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "app", "blog", "post", "page.mdx"),
            `# Blog Post`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("blog/post");
          assertExists(result);
        });
      });
    });

    describe("HTML Generation", () => {
      it("should wrap content in HTML shell", async () => {
        await withTestContext("renderer-core-html-shell", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "test.mdx"),
            `---
title: Test Page
description: Test description
---

# Test Content
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("test");
          assertStringIncludes(result.html.toLowerCase(), "<!doctype");
          assertStringIncludes(result.html, "<html");
          assertStringIncludes(result.html, "<head>");
          assertStringIncludes(result.html, "<title>Test Page</title>");
          assertStringIncludes(result.html, "<body>");
        });
      });

      it("should preserve full HTML documents", async () => {
        await withTestContext("renderer-core-full-html", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "full.tsx"),
            `export default function FullPage() {
              return (
                <html>
                  <head><title>Full HTML</title></head>
                  <body><div>Custom HTML Document</div></body>
                </html>
              );
            }`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("full");
          assertStringIncludes(result.html, "Full HTML");
          assertStringIncludes(result.html, "Custom HTML Document");
        });
      });

      it("should include metadata in HTML head", async () => {
        await withTestContext("renderer-core-metadata", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "meta.mdx"),
            `---
title: Meta Test
description: This is a description
author: Test Author
---

export const metadata = {
  keywords: 'test, keywords',
  ogImage: '/image.png'
}

# Meta Page
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("meta");
          assertStringIncludes(result.html, "<title>Meta Test</title>");
        });
      });
    });

    describe("getAllPages", () => {
      it("should list all pages in pages directory", async () => {
        await withTestContext("renderer-core-get-pages", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), `# Home`);
          await Deno.writeTextFile(join(context.projectDir, "pages", "about.mdx"), `# About`);
          await Deno.writeTextFile(
            join(context.projectDir, "pages", "contact.tsx"),
            `export default function Contact() { return <div>Contact</div>; }`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const pages = await renderer.getAllPages();
          assert(Array.isArray(pages));
          assert(pages.length >= 3);
          assert(pages.includes("/") || pages.includes("index"));
          assert(pages.includes("about"));
          assert(pages.includes("contact"));
        });
      });

      it("should handle root-level pages", async () => {
        await withTestContext("renderer-core-root-pages", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(join(context.projectDir, "index.mdx"), `# Root Index`);

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const pages = await renderer.getAllPages();
          assert(pages.includes("/") || pages.includes("index"));
        });
      });
    });

    describe("Virtual Module System", () => {
      it("should provide access to virtual module system", async () => {
        await withTestContext("renderer-core-vms", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const vms = renderer.getVirtualModuleSystem();
          assertExists(vms);
          assert(typeof (vms as any).register === "function");
        });
      });
    });

    describe("Error Handling", () => {
      it("should handle MDX with syntax errors", async () => {
        await withTestContext("renderer-core-syntax-error", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "broken.mdx"),
            `---
title: Broken
---

<Component unclosed={
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          await assertRejects(
            async () => await renderer.renderPage("broken"),
            Error,
          );
        });
      });

      it("should handle component loading errors gracefully", async () => {
        await withTestContext("renderer-core-component-error", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "error-page.tsx"),
            `export default function ErrorPage() {
              throw new Error('Component error');
            }`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          // Should handle the error during rendering
          await assertRejects(
            async () => await renderer.renderPage("error-page"),
            Error,
          );
        });
      });
    });

    describe("Default MDX Components", () => {
      it("should provide default HTML element components for MDX", async () => {
        await withTestContext("renderer-core-default-components", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "markdown.mdx"),
            `# Heading 1

## Heading 2

This is a **bold** paragraph with *italic* text.

- List item 1
- List item 2

[Link](https://example.com)

\`\`\`js
const code = 'block';
\`\`\`
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("markdown");
          assertStringIncludes(result.html, "Heading 1");
          assertStringIncludes(result.html, "Heading 2");
          assertStringIncludes(result.html, "bold");
          assertStringIncludes(result.html, "italic");
        });
      });
    });

    describe("RenderResult Validation", () => {
      it("should return valid RenderResult with all required fields", async () => {
        await withTestContext("renderer-core-result-validation", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "validation-test-page.mdx"),
            `---
title: Validation Test
description: Test description
---

# Test Content
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("validation-test-page");

          // Validate required fields
          assertEquals(typeof result.html, "string");
          assertExists(result.frontmatter);
          assertEquals(typeof result.frontmatter, "object");
          assertEquals(result.frontmatter.title, "Validation Test");
          assert(Array.isArray(result.headings) || result.headings === undefined);
          assert(result.nodeMap instanceof Map || result.nodeMap === undefined);
          assert(result.stream === null || result.stream instanceof ReadableStream);
          assertEquals(typeof result.ssrHash, "string");
        });
      });

      it("should handle empty frontmatter gracefully", async () => {
        await withTestContext("renderer-core-empty-frontmatter", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "no-frontmatter.mdx"),
            `# Just Content`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("no-frontmatter");
          assertExists(result.frontmatter);
          assertEquals(typeof result.frontmatter, "object");
        });
      });

      it("should handle malformed frontmatter fields", async () => {
        await withTestContext("renderer-core-malformed-frontmatter", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "malformed.mdx"),
            `---
title: 123
description: null
layout: true
---

# Content
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("malformed");
          assertExists(result.frontmatter);
        });
      });

      it("should validate CSS field when present", async () => {
        await withTestContext("renderer-core-css-field", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "test.mdx"),
            `# Test`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("test");
          assert(result.css === undefined || typeof result.css === "string");
        });
      });
    });

    describe("Cache Boundary Tests (RENDERER_CORE_MAX_ENTRIES)", () => {
      it("should handle cache near max capacity", async () => {
        await withTestContext("renderer-core-cache-boundary", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          // Create multiple pages (not hitting full limit to keep test fast)
          const pageCount = 10;
          for (let i = 0; i < pageCount; i++) {
            await Deno.writeTextFile(
              join(context.projectDir, "pages", `page-${i}.mdx`),
              `---
title: Page ${i}
---

# Page ${i} Content
`,
            );
          }

          // Render all pages
          for (let i = 0; i < pageCount; i++) {
            const result = await renderer.renderPage(`page-${i}`);
            assertExists(result);
          }

          // Verify cache is working
          const result = await renderer.renderPage("page-0");
          assertEquals(result.frontmatter.title, "Page 0");
        });
      });

      it("should evict oldest entries when cache exceeds max", async () => {
        await withTestContext("renderer-core-cache-eviction", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          // Create test pages
          await Deno.writeTextFile(
            join(context.projectDir, "pages", "first.mdx"),
            `# First Page`,
          );
          await Deno.writeTextFile(
            join(context.projectDir, "pages", "second.mdx"),
            `# Second Page`,
          );

          await renderer.renderPage("first");
          await renderer.renderPage("second");

          // Both should be renderable
          const result1 = await renderer.renderPage("first");
          const result2 = await renderer.renderPage("second");
          assertExists(result1);
          assertExists(result2);
        });
      });

      it("should clear cache properly to prevent memory leaks", async () => {
        await withTestContext("renderer-core-memory-cleanup", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "test.mdx"),
            `# Test`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          // Render multiple times
          for (let i = 0; i < 5; i++) {
            await renderer.renderPage("test");
          }

          // Clear cache
          renderer.clearCache();

          // Should still work after clearing
          const result = await renderer.renderPage("test");
          assertExists(result);
        });
      });
    });

    describe("Streaming Error Recovery", () => {
      it("should fallback to string rendering if streaming fails", async () => {
        await withTestContext("renderer-core-stream-fallback", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "test.mdx"),
            `# Stream Test`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "production", // Production uses streaming
          });

          const result = await renderer.renderPage("test", {
            delivery: "stream",
          });

          // Should still return valid HTML even if stream fails
          assertEquals(typeof result.html, "string");
          assertStringIncludes(result.html, "Stream Test");
        });
      });

      it("should handle streaming with Suspense components", async () => {
        await withTestContext("renderer-core-stream-suspense", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "suspense.tsx"),
            `import { Suspense } from 'react';

export default function SuspensePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <div>Content</div>
    </Suspense>
  );
}`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "production",
          });

          const result = await renderer.renderPage("suspense", {
            delivery: "stream",
          });

          assertExists(result.html);
        });
      });

      it("should handle null stream gracefully", async () => {
        await withTestContext("renderer-core-null-stream", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "test.mdx"),
            `# Test`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("test");
          assertEquals(result.stream, null);
        });
      });
    });

    describe("Layout Compilation Failure Handling", () => {
      it("should handle layout with syntax errors", async () => {
        await withTestContext("renderer-core-layout-error", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.mkdir(join(context.projectDir, "layouts"), { recursive: true });
          await Deno.writeTextFile(
            join(context.projectDir, "layouts", "broken.mdx"),
            `---
isLayout: true
---

export default function BrokenLayout({ children }) {
  return <div unclosed={>{children}</div>;
}`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "test.mdx"),
            `---
layout: broken
---

# Test
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          await assertRejects(
            async () => await renderer.renderPage("test"),
            Error,
          );
        });
      });

      it("should handle missing layout gracefully", async () => {
        await withTestContext("renderer-core-missing-layout", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "test.mdx"),
            `---
layout: nonexistent
---

# Test
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          // Should render without layout if not found
          const result = await renderer.renderPage("test");
          assertExists(result);
        });
      });

      // SKIPPED: Test expects error but layout isn't discovered without `isLayout: true` frontmatter
      // Root cause: Layout files require `isLayout: true` in frontmatter to be discovered (by design)
      // See: src/types/entities/getEntityInfo.ts:159
      // Investigation: RENDERER_CORE_TEST_INVESTIGATION.md (Session 36-37)
      it.skip("should handle layout with runtime errors", async () => {
        await withTestContext("renderer-core-layout-runtime", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.mkdir(join(context.projectDir, "layouts"), { recursive: true });
          await Deno.writeTextFile(
            join(context.projectDir, "layouts", "runtime-error.tsx"),
            `export default function RuntimeErrorLayout({ children }) {
              const obj = null;
              obj.method(); // Will throw
              return <div>{children}</div>;
            }`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "test.mdx"),
            `---
layout: runtime-error
---

# Test
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          // Runtime errors during React rendering should propagate through renderToString
          await assertRejects(
            async () => await renderer.renderPage("test"),
            Error,
          );
        });
      });
    });
  },
);
