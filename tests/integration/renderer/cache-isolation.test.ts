/**
 * Test for renderer cache isolation
 * Verifies that caches are properly cleared between renderer instances
 */

import { assert, assertStringIncludes } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

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
    describe("MDX Module Cache", () => {
      it("should isolate MDX layouts between different projects", async () => {
        await withTestContext("cache-isolation-mdx", async (context1) => {
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

          // Create a second test context for project 2
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

            // Render from project 1
            const renderer1 = await createRenderer({
              projectDir: context1.projectDir,
              mode: "development",
            });

            const result1 = await renderer1.renderPage("test");
            assertStringIncludes(result1.html, "project1-layout");
            assertStringIncludes(result1.html, "Project 1 Page");
            assert(!result1.html.includes("project2-layout"));

            // Clear caches between tests
            if (renderer1 && typeof renderer1.clearAllState === "function") {
              await renderer1.clearAllState();
            }

            // Clear global caches
            const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");
            await cleanupBundler();

            // Render from project 2 - should not have cached layout from project 1
            const renderer2 = await createRenderer({
              projectDir: context2.projectDir,
              mode: "development",
            });

            const result2 = await renderer2.renderPage("test");
            assertStringIncludes(result2.html, "project2-layout");
            assertStringIncludes(result2.html, "Project 2 Page");
            assert(!result2.html.includes("project1-layout"));

            // Cleanup renderers
            if (renderer1 && typeof renderer1.clearAllState === "function") {
              await renderer1.clearAllState();
            }
            if (renderer2 && typeof renderer2.clearAllState === "function") {
              await renderer2.clearAllState();
            }

            await cleanupBundler();
          });
        });
      });
    });

    describe("TSX Layout Cache", () => {
      it("should clear TSX layout module cache properly", async () => {
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
          const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");
          await cleanupBundler();
        });
      });
    });
  },
);
