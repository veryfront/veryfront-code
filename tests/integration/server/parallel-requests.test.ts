/**
 * Test for parallel request handling
 *
 * Verifies that concurrent requests to the same page don't cause:
 * 1. "body already consumed" errors (from shared Response streams)
 * 2. Singleflight deadlocks (from recursive dependency resolution)
 *
 * @see https://github.com/veryfront/veryfront-renderer/issues/XXX
 */

import { assertEquals, assertNotEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

async function withRenderer(
  projectDir: string,
  fn: (renderer: Awaited<ReturnType<typeof createRenderer>>) => Promise<void>,
): Promise<void> {
  const renderer = await createRenderer({ projectDir, mode: "development" });

  try {
    await fn(renderer);
  } finally {
    if (typeof renderer.clearAllState === "function") {
      await renderer.clearAllState();
    }
  }
}

// Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
describe(
  "Parallel Request Handling",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    afterAll(async () => {
      await cleanupBundler();
    });

    describe("Concurrent Renders", () => {
      it("should handle multiple concurrent requests to the same page without errors", async () => {
        await withTestContext("parallel-requests-same-page", async (context) => {
          await mkdir(join(context.projectDir, "app", "test"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "app", "test", "page.mdx"),
            `# Parallel Test Page

This is a test page for verifying parallel request handling.

<div className="test-content">Content here</div>`,
          );

          await withRenderer(context.projectDir, async (renderer) => {
            const results = await Promise.all(
              Array.from({ length: 5 }, () =>
                renderer.renderPage("test").catch((error) => ({
                  error: true as const,
                  message: error instanceof Error ? error.message : String(error),
                })),
              ),
            );

            for (let i = 0; i < results.length; i++) {
              const result = results[i];

              if (result && typeof result === "object" && "error" in result) {
                throw new Error(`Request ${i + 1} failed with: ${result.message}`);
              }

              assertStringIncludes(
                result.html,
                "Parallel Test Page",
                `Request ${i + 1} should contain expected content`,
              );
            }

            for (const result of results) {
              assertNotEquals(result.html.length, 0, "HTML should not be empty");
            }
          });
        });
      });

      it("should handle concurrent requests to different pages", async () => {
        await withTestContext("parallel-requests-diff-pages", async (context) => {
          await mkdir(join(context.projectDir, "app", "page1"), { recursive: true });
          await mkdir(join(context.projectDir, "app", "page2"), { recursive: true });
          await mkdir(join(context.projectDir, "app", "page3"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "app", "page1", "page.mdx"),
            `# Page One\n\nContent for page one.`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "page2", "page.mdx"),
            `# Page Two\n\nContent for page two.`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "page3", "page.mdx"),
            `# Page Three\n\nContent for page three.`,
          );

          await withRenderer(context.projectDir, async (renderer) => {
            const results = await Promise.all([
              renderer.renderPage("page1"),
              renderer.renderPage("page2"),
              renderer.renderPage("page3"),
              renderer.renderPage("page1"),
              renderer.renderPage("page2"),
            ]);

            assertStringIncludes(results[0]!.html, "Page One");
            assertStringIncludes(results[1]!.html, "Page Two");
            assertStringIncludes(results[2]!.html, "Page Three");
            assertStringIncludes(results[3]!.html, "Page One");
            assertStringIncludes(results[4]!.html, "Page Two");
          });
        });
      });
    });

    describe("HTTP Module Cache", () => {
      it("should handle pages with esm.sh imports without hanging", async () => {
        await withTestContext("http-cache-no-deadlock", async (context) => {
          await mkdir(join(context.projectDir, "app", "imports"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "app", "imports", "page.mdx"),
            `# Import Test

Testing that ESM imports don't cause deadlocks.

<div>Test content</div>`,
          );

          await withRenderer(context.projectDir, async (renderer) => {
            const startTime = Date.now();
            const result = await renderer.renderPage("imports");
            const duration = Date.now() - startTime;

            assertEquals(
              duration < 10000,
              true,
              `Render should complete quickly but took ${duration}ms`,
            );

            assertStringIncludes(result.html, "Import Test");
          });
        });
      });
    });

    describe("Stress Test", () => {
      it("should handle 10 concurrent requests without failures", async () => {
        await withTestContext("stress-test-concurrent", async (context) => {
          await mkdir(join(context.projectDir, "app", "stress"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "app", "stress", "page.mdx"),
            `# Stress Test Page

Testing concurrent request handling under load.`,
          );

          await withRenderer(context.projectDir, async (renderer) => {
            const results = await Promise.all(
              Array.from({ length: 10 }, (_, index) =>
                renderer
                  .renderPage("stress")
                  .then((result) => ({ success: true as const, html: result.html, index }))
                  .catch((error) => ({
                    success: false as const,
                    error: error instanceof Error ? error.message : String(error),
                    index,
                  })),
              ),
            );

            const successes = results.filter((r) => r.success);
            const failures = results.filter((r) => !r.success);

            assertEquals(
              failures.length,
              0,
              `Expected no failures but got ${failures.length}: ${failures
                .map((f) => `#${f.index}: ${f.error}`)
                .join(", ")}`,
            );

            assertEquals(successes.length, 10, "All 10 requests should succeed");

            for (const result of successes) {
              assertStringIncludes(result.html, "Stress Test Page");
            }
          });
        });
      });
    });
  },
);
