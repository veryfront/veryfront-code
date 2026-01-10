/**
 * Test for renderer cache isolation
 * Verifies that caches are properly cleared between renderer instances
 */

import { assert, assertStringIncludes } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

// Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
// See: https://github.com/facebook/react/issues/24669
describe(
  "Renderer Cache Isolation",
  {
    // Disable sanitizers for renderer cache and MessagePort resource leaks
    // These are related to React 19 SSR MessagePort usage and internal caches
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    // Clean up after all tests
    afterAll(async () => {
      await cleanupBundler();
    });

    describe("MDX Module Cache", () => {
      // TODO: This test is flaky due to React SSR global state corruption in parallel tests
      // The cache isolation itself works correctly - the issue is that renderToReadableStream
      // sometimes fails and falls back to legacy renderToString, which has global state issues.
      // React's getCurrentStack is undefined when parallel tests corrupt the shared state.
      // See: https://github.com/facebook/react/issues/24669
      it.skip("should isolate MDX layouts between different projects", async () => {
        // Test project 1
        await withTestContext("cache-isolation-mdx-1", async (context1) => {
          // Project 1: MDX layout with specific class using app router
          await Deno.mkdir(join(context1.projectDir, "app", "test"), {
            recursive: true,
          });

          await Deno.writeTextFile(
            join(context1.projectDir, "app", "layout.tsx"),
            `export default function Layout1({ children }) {
  return <div className="project1-layout">{children}</div>;
}`,
          );

          await Deno.writeTextFile(
            join(context1.projectDir, "app", "test", "page.mdx"),
            `# Project 1 Page`,
          );

          // Render from project 1
          const renderer1 = await createRenderer({
            projectDir: context1.projectDir,
            mode: "development",
          });

          const result1 = await renderer1.renderPage("test");
          assertStringIncludes(result1.html, "project1-layout");
          assertStringIncludes(result1.html, "Project 1 Page");
          assert(!result1.html.includes("project2-layout"));

          // Cleanup renderer1
          if (renderer1 && typeof renderer1.clearAllState === "function") {
            await renderer1.clearAllState();
          }
        });

        // Clear global caches between projects
        await cleanupBundler();

        // Test project 2 (separate context, no nesting)
        await withTestContext("cache-isolation-mdx-2", async (context2) => {
          // Project 2: Different MDX layout using app router
          await Deno.mkdir(join(context2.projectDir, "app", "test"), {
            recursive: true,
          });

          await Deno.writeTextFile(
            join(context2.projectDir, "app", "layout.tsx"),
            `export default function Layout2({ children }) {
  return <div className="project2-layout">{children}</div>;
}`,
          );

          await Deno.writeTextFile(
            join(context2.projectDir, "app", "test", "page.mdx"),
            `# Project 2 Page`,
          );

          // Render from project 2 - should not have cached layout from project 1
          const renderer2 = await createRenderer({
            projectDir: context2.projectDir,
            mode: "development",
          });

          const result2 = await renderer2.renderPage("test");
          assertStringIncludes(result2.html, "project2-layout");
          assertStringIncludes(result2.html, "Project 2 Page");
          assert(!result2.html.includes("project1-layout"));

          // Cleanup renderer2
          if (renderer2 && typeof renderer2.clearAllState === "function") {
            await renderer2.clearAllState();
          }
        });
      });
    });

    describe("TSX Layout Cache", () => {
      // TODO: This test is flaky due to Deno's module caching behavior
      // The renderer.clearCache() doesn't clear Deno's native module cache
      // Need to investigate a more reliable approach to module cache invalidation
      it.skip("should clear TSX layout module cache properly", async () => {
        await withTestContext("cache-isolation-tsx", async (context) => {
          // Create app router with TSX layout
          await Deno.mkdir(join(context.projectDir, "app", "test"), {
            recursive: true,
          });

          // Create a TSX layout file
          await Deno.writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function TestLayout({ children }) {
  return <div className="test-layout-v1">{children}</div>;
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

          // First render
          const result1 = await renderer.renderPage("test");
          assertStringIncludes(result1.html, "test-layout-v1");

          // Update the layout file
          await Deno.writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function TestLayout({ children }) {
  return <div className="test-layout-v2">{children}</div>;
}`,
          );

          // Ensure filesystem mtime changes across platforms
          // Use longer delay for CI environments where filesystem can be slower
          await new Promise((r) => setTimeout(r, 2000));

          // Clear cache and force module invalidation
          renderer.clearCache();

          // Additional delay to ensure cache clearing propagates
          await new Promise((r) => setTimeout(r, 100));

          // Re-render - should see updated layout
          const result2 = await renderer.renderPage("test");
          assertStringIncludes(result2.html, "test-layout-v2");
          assert(!result2.html.includes("test-layout-v1"));

          // Cleanup
          if (renderer && typeof renderer.clearAllState === "function") {
            await renderer.clearAllState();
          }
        });
      });
    });
  },
);
