import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { describe, it } from "#veryfront/testing/bdd";

import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

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
        await mkdir(blogDir, { recursive: true });

        await writeTextFile(
          join(blogDir, "page.tsx"),
          `export default function Page() {
  return <div>App Router Page</div>;
}`,
        );

        await writeTextFile(
          join(appDir, "loading.tsx"),
          `export default function Loading() {
  return <div className="loading">Loading...</div>;
}`,
        );

        await writeTextFile(
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

        await writeTextFile(
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
      });
    });

    it("renders the segment error.tsx when an app-router page throws during SSR", async () => {
      await withTestContext("error-boundary-catch", async (context) => {
        const appDir = join(context.projectDir, "app");
        const brokenDir = join(appDir, "broken");
        await mkdir(brokenDir, { recursive: true });

        await writeTextFile(
          join(brokenDir, "page.tsx"),
          `export default function Broken() { throw new Error("kaboom-ssr"); }`,
        );
        await writeTextFile(
          join(appDir, "error.tsx"),
          `"use client";
export default function ErrorBoundary({ error }) {
  return <div id="error-boundary">error.tsx caught: {error?.message}</div>;
}`,
        );

        const renderer = await createRenderer({
          projectDir: context.projectDir,
          mode: "development",
        });

        // React error boundaries don't catch an SSR render throw, so the
        // framework catches it and renders error.tsx as the response body,
        // signalling a 500 by throwing the built document (errored pages must
        // not cache). The document carries error.tsx + errorPath for the client.
        let signal: { errorBoundaryHtml?: string } | undefined;
        try {
          await renderer.renderPage("broken");
        } catch (error) {
          signal = error as { errorBoundaryHtml?: string };
        }

        assert(signal, "renderPage should throw the error-boundary signal");
        const html = signal.errorBoundaryHtml ?? "";
        assertStringIncludes(
          html,
          'id="error-boundary"',
          "error.tsx rendered as the response body",
        );
        assertStringIncludes(html, "kaboom-ssr", "error.tsx received the caught error");
        assertStringIncludes(
          html,
          "errorPath",
          "errorPath embedded so the client wraps the boundary",
        );
      });
    });
  },
);
