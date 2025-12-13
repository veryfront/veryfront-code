import { assertEquals, assertStringIncludes } from "std/assert/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

  // Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
  describe(
  "App Router TSX Layout Support",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    it("should render TSX layouts in app router", async () => {
      await withTestContext("tsx-layout-app-router", async (context) => {
        await ensureDir(join(context.projectDir, "app", "blog"));

        await Deno.writeTextFile(
          join(context.projectDir, "app", "layout.tsx"),
          `export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <div className="root-tsx-layout">
          <header>Header from TSX</header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}`,
        );

        await Deno.writeTextFile(
          join(context.projectDir, "app", "blog", "layout.tsx"),
          `export default function BlogLayout({ children }) {
  return (
    <div className="blog-tsx-layout">
      <nav>Blog Navigation</nav>
      <article>{children}</article>
    </div>
  );
}`,
        );

        await Deno.writeTextFile(
          join(context.projectDir, "app", "blog", "page.mdx"),
          `# Blog Post

This is content from the MDX page.`,
        );

        const renderer = await createRenderer({
          projectDir: context.projectDir,
          mode: "development",
        });

        const result = await renderer.renderPage("blog");
        const html = result.html;

        assertStringIncludes(html, 'class="root-tsx-layout"');
        assertStringIncludes(html, 'class="blog-tsx-layout"');
        assertStringIncludes(html, "Header from TSX");
        assertStringIncludes(html, "Blog Navigation");
        assertStringIncludes(html, "Blog Post");

        const rootIdx = html.indexOf('class="root-tsx-layout"');
        const blogIdx = html.indexOf('class="blog-tsx-layout"');
        assertEquals(rootIdx < blogIdx, true, "Root layout should wrap blog layout");

        if (renderer && typeof renderer.clearAllState === "function") {
          await renderer.clearAllState();
        }
      });
    });
  },
);
