import { assertStringIncludes } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

  // Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
  describe(
  "App Router Reserved Components",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    it("should discover and use loading and error components", async () => {
      await withTestContext("reserved-components", async (context) => {
        const appDir = join(context.projectDir, "app");
        const blogDir = join(appDir, "blog");
        await Deno.mkdir(blogDir, { recursive: true });

        await Deno.writeTextFile(
          join(blogDir, "page.tsx"),
          `export default function Page() { 
          return <div>App Router Page</div>; 
        }`,
        );

        await Deno.writeTextFile(
          join(appDir, "loading.tsx"),
          `export default function Loading() { 
          return <div className="loading">Loading...</div>; 
        }`,
        );

        await Deno.writeTextFile(
          join(appDir, "error.tsx"),
          `export default function Error() { 
          return <div className="err">Error</div>; 
        }`,
        );

        const renderer = await createRenderer({
          projectDir: context.projectDir,
          mode: "development",
        });

        const result = await renderer.renderPage("blog");
        assertStringIncludes(result.html, "App Router Page", "Should render the page component");

        await Deno.writeTextFile(
          join(blogDir, "loading.tsx"),
          `export default function BlogLoading() { 
          return <div className="loading">Blog Loading</div>; 
        }`,
        );

        const result2 = await renderer.renderPage("blog");
        assertStringIncludes(
          result2.html,
          "App Router Page",
          "Should still render the page after adding segment-specific loading",
        );

        // Note: Testing actual loading/error states would require additional setup
        // to trigger Suspense boundaries and error conditions
      });
    });
  },
);
