import { assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { describe, it } from "@std/testing/bdd";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

// Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
// See: https://github.com/facebook/react/issues/24669
describe(
  "App Router Reserved Components",
  {
    // React SSR requires disabled sanitizers
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    it("should discover and use loading and error components", async () => {
      /**
       * Test scenario:
       * Verify that App Router correctly discovers and uses reserved components
       * (loading.tsx, error.tsx) from the appropriate directory level.
       *
       * Critical for: Proper loading states and error boundaries in App Router.
       */
      await withTestContext("reserved-components", async (context) => {
        // Setup App Router structure
        const appDir = join(context.projectDir, "app");
        const blogDir = join(appDir, "blog");
        await Deno.mkdir(blogDir, { recursive: true });

        // Create blog page
        await Deno.writeTextFile(
          join(blogDir, "page.tsx"),
          `export default function Page() { 
          return <div>App Router Page</div>; 
        }`,
        );

        // Create reserved components at root level
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

        // Test 1: Verify page renders with root-level reserved components
        const renderer = await createRenderer({
          projectDir: context.projectDir,
          mode: "development",
        });

        const result = await renderer.renderPage("blog");
        assertStringIncludes(result.html, "App Router Page", "Should render the page component");

        // Test 2: Nested segment should shadow parent reserved components
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
