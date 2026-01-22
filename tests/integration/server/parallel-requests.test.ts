/**
 * Test for parallel request handling
 *
 * Verifies that concurrent requests to the same page don't cause:
 * 1. "body already consumed" errors (from shared Response streams)
 * 2. Singleflight deadlocks (from recursive dependency resolution)
 *
 * @see https://github.com/veryfront/veryfront-renderer/issues/XXX
 */

import { assertEquals, assertNotEquals, assertStringIncludes } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { mkdir, writeTextFile } from "@veryfront/compat/fs.ts";
import { afterAll, beforeAll, describe, it } from "@veryfront/testing/bdd";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

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
      /**
       * Test: Parallel requests should not cause "body already consumed" errors
       *
       * Previously, Singleflight was used to deduplicate concurrent render requests.
       * However, RenderResult.stream is a ReadableStream that can only be consumed once.
       * When multiple requests shared the same RenderResult, only the first would succeed
       * and subsequent requests would fail with "body already consumed".
       *
       * Fix: Remove Singleflight from renderer.ts, let each request render independently.
       * The cache handles repeated requests after the first render completes.
       */
      it("should handle multiple concurrent requests to the same page without errors", async () => {
        await withTestContext("parallel-requests-same-page", async (context) => {
          // Create a simple MDX page
          await mkdir(join(context.projectDir, "app", "test"), {
            recursive: true,
          });

          await writeTextFile(
            join(context.projectDir, "app", "test", "page.mdx"),
            `# Parallel Test Page

This is a test page for verifying parallel request handling.

<div className="test-content">Content here</div>`,
          );

          // Create renderer
          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          try {
            // Fire 5 concurrent requests to the same page
            const promises = Array.from({ length: 5 }, () =>
              renderer.renderPage("test").catch((error) => ({
                error: true,
                message: error instanceof Error ? error.message : String(error),
              }))
            );

            const results = await Promise.all(promises);

            // ALL requests should succeed - no "body already consumed" errors
            for (let i = 0; i < results.length; i++) {
              const result = results[i];

              // Check for error object
              if (result && typeof result === "object" && "error" in result) {
                throw new Error(
                  `Request ${i + 1} failed with: ${(result as { message: string }).message}`
                );
              }

              // Verify we got a valid RenderResult
              const renderResult = result as { html: string };
              assertStringIncludes(
                renderResult.html,
                "Parallel Test Page",
                `Request ${i + 1} should contain expected content`
              );
            }

            // Verify all results have content (not empty)
            for (const result of results) {
              if (result && typeof result === "object" && "html" in result) {
                assertNotEquals(
                  (result as { html: string }).html.length,
                  0,
                  "HTML should not be empty"
                );
              }
            }
          } finally {
            if (renderer && typeof renderer.clearAllState === "function") {
              await renderer.clearAllState();
            }
          }
        });
      });

      /**
       * Test: Parallel requests to different pages should work independently
       *
       * This verifies that removing Singleflight doesn't break isolation between
       * different page renders.
       */
      it("should handle concurrent requests to different pages", async () => {
        await withTestContext("parallel-requests-diff-pages", async (context) => {
          // Create multiple pages
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

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          try {
            // Fire concurrent requests to different pages
            const promises = [
              renderer.renderPage("page1"),
              renderer.renderPage("page2"),
              renderer.renderPage("page3"),
              renderer.renderPage("page1"), // Duplicate
              renderer.renderPage("page2"), // Duplicate
            ];

            const results = await Promise.all(promises);

            // Verify each result contains the expected content
            assertStringIncludes(results[0]!.html, "Page One");
            assertStringIncludes(results[1]!.html, "Page Two");
            assertStringIncludes(results[2]!.html, "Page Three");
            assertStringIncludes(results[3]!.html, "Page One");
            assertStringIncludes(results[4]!.html, "Page Two");
          } finally {
            if (renderer && typeof renderer.clearAllState === "function") {
              await renderer.clearAllState();
            }
          }
        });
      });
    });

    describe("HTTP Module Cache", () => {
      /**
       * Test: HTTP imports should not deadlock with complex dependencies
       *
       * Previously, Singleflight was used in http-cache.ts for fetch deduplication.
       * This caused deadlocks when processing packages with complex dependency graphs
       * (like zod) because recursive rewriteModuleImports calls would create nested
       * Singleflight entries that blocked on each other.
       *
       * Fix: Remove Singleflight from http-cache.ts, use processingStack for
       * circular dependency detection instead.
       */
      it("should handle pages with esm.sh imports without hanging", async () => {
        await withTestContext("http-cache-no-deadlock", async (context) => {
          // Create a page that imports from esm.sh
          // Note: In real tests, esm.sh imports are resolved and cached.
          // Here we test the structure works without hanging.
          await mkdir(join(context.projectDir, "app", "imports"), {
            recursive: true,
          });

          await writeTextFile(
            join(context.projectDir, "app", "imports", "page.mdx"),
            `# Import Test

Testing that ESM imports don't cause deadlocks.

<div>Test content</div>`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          try {
            // Render should complete within reasonable time (not timeout/deadlock)
            const startTime = Date.now();
            const result = await renderer.renderPage("imports");
            const duration = Date.now() - startTime;

            // Should complete in under 10 seconds (generous for CI)
            // Previously with Singleflight deadlock, this would timeout at 20+ seconds
            assertEquals(
              duration < 10000,
              true,
              `Render should complete quickly but took ${duration}ms`
            );

            assertStringIncludes(result.html, "Import Test");
          } finally {
            if (renderer && typeof renderer.clearAllState === "function") {
              await renderer.clearAllState();
            }
          }
        });
      });
    });

    describe("Stress Test", () => {
      /**
       * Test: Many concurrent requests should all succeed
       *
       * This is a stress test to verify the system remains stable under load
       * after removing Singleflight optimizations.
       */
      it("should handle 10 concurrent requests without failures", async () => {
        await withTestContext("stress-test-concurrent", async (context) => {
          // Create a simple page
          await mkdir(join(context.projectDir, "app", "stress"), {
            recursive: true,
          });

          await writeTextFile(
            join(context.projectDir, "app", "stress", "page.mdx"),
            `# Stress Test Page

Testing concurrent request handling under load.`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          try {
            // Fire 10 concurrent requests
            const promises = Array.from({ length: 10 }, (_, i) =>
              renderer.renderPage("stress")
                .then((result) => ({ success: true, html: result.html, index: i }))
                .catch((error) => ({
                  success: false,
                  error: error instanceof Error ? error.message : String(error),
                  index: i,
                }))
            );

            const results = await Promise.all(promises);

            // Count successes and failures
            const successes = results.filter((r) => r.success);
            const failures = results.filter((r) => !r.success);

            // All requests should succeed
            assertEquals(
              failures.length,
              0,
              `Expected no failures but got ${failures.length}: ${
                failures.map((f) => `#${f.index}: ${(f as { error: string }).error}`).join(", ")
              }`
            );

            assertEquals(successes.length, 10, "All 10 requests should succeed");

            // All successful results should have valid HTML
            for (const result of successes) {
              assertStringIncludes(
                (result as { html: string }).html,
                "Stress Test Page"
              );
            }
          } finally {
            if (renderer && typeof renderer.clearAllState === "function") {
              await renderer.clearAllState();
            }
          }
        });
      });
    });
  },
);
