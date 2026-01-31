import { assertEquals, assertStringIncludes } from "@veryfront/testing/assert";
import { mkdir, writeTextFile } from "@veryfront/compat/fs.ts";
import { join } from "@veryfront/compat/path";
import { describe, it } from "@veryfront/testing/bdd";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

// Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
// See: https://github.com/facebook/react/issues/24669
describe(
  "App Router TSX Layout Support",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    it("should render TSX layouts in app router", async () => {
      await withTestContext("tsx-layout-app-router", async (context) => {
        await mkdir(join(context.projectDir, "app", "blog"), { recursive: true });

        await writeTextFile(
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

        await writeTextFile(
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

        await writeTextFile(
          join(context.projectDir, "app", "blog", "page.mdx"),
          `# Blog Post

This is content from the MDX page.`,
        );

        const renderer = await createRenderer({
          projectDir: context.projectDir,
          mode: "development",
        });

        const { html } = await renderer.renderPage("blog");

        assertStringIncludes(html, 'class="root-tsx-layout"');
        assertStringIncludes(html, 'class="blog-tsx-layout"');
        assertStringIncludes(html, "Header from TSX");
        assertStringIncludes(html, "Blog Navigation");
        assertStringIncludes(html, "Blog Post");

        const rootIdx = html.indexOf('class="root-tsx-layout"');
        const blogIdx = html.indexOf('class="blog-tsx-layout"');
        assertEquals(rootIdx < blogIdx, true, "Root layout should wrap blog layout");

        if (typeof renderer.clearAllState === "function") {
          await renderer.clearAllState();
        }
      });
    });
  },
);
