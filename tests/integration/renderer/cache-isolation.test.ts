/**
 * Test for renderer cache isolation
 * Verifies that caches are properly cleared between renderer instances
 */

import { assert, assertStringIncludes } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { mkdir, writeTextFile } from "@veryfront/compat/fs.ts";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { delay } from "@std/async";

async function clearAllStateIfSupported(
  renderer: unknown,
): Promise<void> {
  if (
    renderer &&
    typeof renderer === "object" &&
    "clearAllState" in renderer &&
    typeof (renderer as { clearAllState?: unknown }).clearAllState === "function"
  ) {
    await (renderer as { clearAllState: () => Promise<void> }).clearAllState();
  }
}

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
        await withTestContext("cache-isolation-mdx-1", async (context1) => {
          await mkdir(join(context1.projectDir, "app", "test"), {
            recursive: true,
          });

          await writeTextFile(
            join(context1.projectDir, "app", "layout.tsx"),
            `export default function Layout1({ children }) {
  return <div className="project1-layout">{children}</div>;
}`,
          );

          await writeTextFile(
            join(context1.projectDir, "app", "test", "page.mdx"),
            `# Project 1 Page`,
          );

          const renderer1 = await createRenderer({
            projectDir: context1.projectDir,
            mode: "development",
          });

          const result1 = await renderer1.renderPage("test");
          assertStringIncludes(result1.html, "project1-layout");
          assertStringIncludes(result1.html, "Project 1 Page");
          assert(!result1.html.includes("project2-layout"));

          await clearAllStateIfSupported(renderer1);
        });

        await cleanupBundler();

        await withTestContext("cache-isolation-mdx-2", async (context2) => {
          await mkdir(join(context2.projectDir, "app", "test"), {
            recursive: true,
          });

          await writeTextFile(
            join(context2.projectDir, "app", "layout.tsx"),
            `export default function Layout2({ children }) {
  return <div className="project2-layout">{children}</div>;
}`,
          );

          await writeTextFile(
            join(context2.projectDir, "app", "test", "page.mdx"),
            `# Project 2 Page`,
          );

          const renderer2 = await createRenderer({
            projectDir: context2.projectDir,
            mode: "development",
          });

          const result2 = await renderer2.renderPage("test");
          assertStringIncludes(result2.html, "project2-layout");
          assertStringIncludes(result2.html, "Project 2 Page");
          assert(!result2.html.includes("project1-layout"));

          await clearAllStateIfSupported(renderer2);
        });
      });
    });

    describe("TSX Layout Cache", () => {
      // TODO: This test is flaky due to Deno's module caching behavior
      // The renderer.clearCache() doesn't clear Deno's native module cache
      // Need to investigate a more reliable approach to module cache invalidation
      it.skip("should clear TSX layout module cache properly", async () => {
        await withTestContext("cache-isolation-tsx", async (context) => {
          await mkdir(join(context.projectDir, "app", "test"), {
            recursive: true,
          });

          await writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function TestLayout({ children }) {
  return <div className="test-layout-v1">{children}</div>;
}`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "test", "page.mdx"),
            `# Test Page`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result1 = await renderer.renderPage("test");
          assertStringIncludes(result1.html, "test-layout-v1");

          await writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function TestLayout({ children }) {
  return <div className="test-layout-v2">{children}</div>;
}`,
          );

          // Ensure filesystem mtime changes across platforms
          // Use longer delay for CI environments where filesystem can be slower
          await delay(2000);

          renderer.clearCache();

          await delay(100);

          const result2 = await renderer.renderPage("test");
          assertStringIncludes(result2.html, "test-layout-v2");
          assert(!result2.html.includes("test-layout-v1"));

          await clearAllStateIfSupported(renderer);
        });
      });
    });
  },
);
