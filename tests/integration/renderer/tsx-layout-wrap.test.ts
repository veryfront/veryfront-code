import { assertStringIncludes } from "@veryfront/testing/assert";
import { mkdir, remove, writeTextFile } from "@veryfront/compat/fs.ts";
import { join } from "@veryfront/compat/path";
import { describe, it } from "@veryfront/testing/bdd";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

// Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
// See: https://github.com/facebook/react/issues/24669
describe(
  "TSX Layout",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    it("nested layout wraps page content", async () => {
      await withTestContext("tsx-layout-wrap", async (context) => {
        await remove(join(context.projectDir, "app"), { recursive: true });

        const pages = join(context.projectDir, "pages", "blog");
        await mkdir(pages, { recursive: true });

        await writeTextFile(
          join(context.projectDir, "pages", "layout.tsx"),
          `
        export default function RootLayout({ children }){
          return (<div id="root-layout">{children}</div>);
        }
      `,
        );

        await writeTextFile(
          join(pages, "layout.tsx"),
          `
        export default function BlogLayout({ children }){
          return (<main id="blog-main">{children}</main>);
        }
      `,
        );

        await writeTextFile(join(pages, "index.mdx"), `# Hello from Blog`);

        const renderer = await createRenderer({
          projectDir: context.projectDir,
          mode: "development",
        });

        const result = await renderer.renderPage("blog/index");
        assertStringIncludes(result.html, 'id="root-layout"');
        assertStringIncludes(result.html, 'id="blog-main"');
        assertStringIncludes(result.html, "Hello from Blog");
      });
    });
  },
);
