
import { assert, assertStringIncludes } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { createRenderer } from "../../../src/rendering/index.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { withTestContext } from "../../_helpers/context.ts";

  // Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
  describe(
  "Renderer State Isolation",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    it("should isolate state between multiple renderers", async () => {
      await withTestContext("state-isolation-1", async (context1) => {
        await withTestContext("state-isolation-2", async (context2) => {
          await Deno.mkdir(join(context1.projectDir, "app", "blog"), {
            recursive: true,
          });
          await Deno.writeTextFile(
            join(context1.projectDir, "app", "layout.mdx"),
            `---
isLayout: true
---
export default function Layout1({ children }) { return (<div className="layout-1">{children}</div>); }`,
          );
          await Deno.writeTextFile(
            join(context1.projectDir, "app", "blog", "page.mdx"),
            `# Blog 1

Content from project 1`,
          );

          await Deno.mkdir(join(context2.projectDir, "app", "blog"), {
            recursive: true,
          });
          await Deno.writeTextFile(
            join(context2.projectDir, "app", "layout.mdx"),
            `---
isLayout: true
---
export default function Layout2({ children }) { return (<div className="layout-2">{children}</div>); }`,
          );
          await Deno.writeTextFile(
            join(context2.projectDir, "app", "blog", "page.mdx"),
            `# Blog 2

Content from project 2`,
          );

          const renderer1 = await createRenderer({
            projectDir: context1.projectDir,
            mode: "development",
          });

          const renderer2 = await createRenderer({
            projectDir: context2.projectDir,
            mode: "development",
          });

          const result1 = await renderer1.renderPage("blog");
          assertStringIncludes(result1.html, "layout-1");
          assertStringIncludes(result1.html, "Blog 1");
          assertStringIncludes(result1.html, "Content from project 1");
          assert(!result1.html.includes("layout-2"), "Should not contain layout-2");

          const result2 = await renderer2.renderPage("blog");
          assertStringIncludes(result2.html, "layout-2");
          assertStringIncludes(result2.html, "Blog 2");
          assertStringIncludes(result2.html, "Content from project 2");
          assert(!result2.html.includes("layout-1"), "Should not contain layout-1");

          const result1Again = await renderer1.renderPage("blog");
          assertStringIncludes(result1Again.html, "layout-1");
          assertStringIncludes(result1Again.html, "Blog 1");
          assert(!result1Again.html.includes("layout-2"), "Should not contain layout-2");

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

    it("should handle sequential tests with different router types", async () => {
      await withTestContext("seq-test-pages", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages"), { recursive: true });
        await Deno.mkdir(join(context.projectDir, "layouts"), {
          recursive: true,
        });

        await Deno.writeTextFile(
          join(context.projectDir, "layouts", "main.mdx"),
          `---
isLayout: true
---
export default function MainLayout({ children }) { return (<div className="pages-layout">{children}</div>); }`,
        );

        await Deno.writeTextFile(
          join(context.projectDir, "pages", "index.mdx"),
          `---
layout: main
---
# Pages Router

Using pages router`,
        );

        const renderer = await createRenderer({
          projectDir: context.projectDir,
          mode: "development",
        });

        const result = await renderer.renderPage("index");
        assertStringIncludes(result.html, "pages-layout");
        assertStringIncludes(result.html, "Pages Router");

        if (renderer && typeof renderer.clearAllState === "function") {
          await renderer.clearAllState();
        }
        await cleanupBundler();
      });

      await withTestContext("seq-test-app", async (context) => {
        await Deno.mkdir(join(context.projectDir, "app", "blog", "post"), {
          recursive: true,
        });

        await Deno.writeTextFile(
          join(context.projectDir, "app", "layout.mdx"),
          `---
isLayout: true
---
export default function RootLayout({ children }) { return (<div className="root-layout"><main>{children}</main></div>); }`,
        );

        await Deno.writeTextFile(
          join(context.projectDir, "app", "blog", "layout.tsx"),
          `export default function BlogLayout({ children }) { return (<div className="blog-layout">{children}</div>); }`,
        );

        await Deno.writeTextFile(
          join(context.projectDir, "app", "blog", "post", "page.mdx"),
          `# App Router Page

Hello from App Router page.`,
        );

        const renderer = await createRenderer({
          projectDir: context.projectDir,
          mode: "development",
        });

        const result = await renderer.renderPage("blog/post");
        const html = result.html;

        const rootIdx = html.indexOf('class="root-layout"');
        const blogIdx = html.indexOf('class="blog-layout"');

        assert(rootIdx !== -1, "Should contain root-layout");
        assert(blogIdx !== -1, "Should contain blog-layout");
        assert(rootIdx < blogIdx, "Root layout should wrap blog layout");
        assertStringIncludes(html, "App Router Page");

        assert(
          !html.includes("pages-layout"),
          "Should not contain pages-layout from previous test",
        );

        if (renderer && typeof renderer.clearAllState === "function") {
          await renderer.clearAllState();
        }
        await cleanupBundler();
      });
    });
  },
);
