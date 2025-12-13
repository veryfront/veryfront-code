
import { assert, assertStringIncludes } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

  // Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
  describe(
  "Renderer Cache Isolation",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    describe("MDX Module Cache", () => {
      it("should isolate MDX layouts between different projects", async () => {
        await withTestContext("cache-isolation-mdx", async (context1) => {
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

          await withTestContext("cache-isolation-mdx-2", async (context2) => {
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

            const renderer1 = await createRenderer({
              projectDir: context1.projectDir,
              mode: "development",
            });

            const result1 = await renderer1.renderPage("test");
            assertStringIncludes(result1.html, "project1-layout");
            assertStringIncludes(result1.html, "Project 1 Page");
            assert(!result1.html.includes("project2-layout"));

            if (renderer1 && typeof renderer1.clearAllState === "function") {
              await renderer1.clearAllState();
            }

            const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");
            await cleanupBundler();

            const renderer2 = await createRenderer({
              projectDir: context2.projectDir,
              mode: "development",
            });

            const result2 = await renderer2.renderPage("test");
            assertStringIncludes(result2.html, "project2-layout");
            assertStringIncludes(result2.html, "Project 2 Page");
            assert(!result2.html.includes("project1-layout"));

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
          await Deno.mkdir(join(context.projectDir, "app", "test"), {
            recursive: true,
          });

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

          const result1 = await renderer.renderPage("test");
          assertStringIncludes(result1.html, "test-layout-v1");

          await Deno.writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function TestLayout({ children }) {
  return <div className="test-layout-v2">{children}</div>;
}`,
          );

          await new Promise((r) => setTimeout(r, 1100));

          renderer.clearCache();

          const result2 = await renderer.renderPage("test");
          assertStringIncludes(result2.html, "test-layout-v2");
          assert(!result2.html.includes("test-layout-v1"));

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
