/**
 * Production Server Tests
 *
 * Tests production server functionality:
 * - Static asset serving with caching headers
 * - App Router and Pages Router rendering
 * - API routes
 * - Security headers (CSP, CORS, etc.)
 * - Error handling
 * - Performance and concurrency
 */

import { assert, assertEquals, assertExists } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import { mkdir, writeTextFile } from "@veryfront/testing/deno-compat";

import { restoreLogs } from "../../_helpers/log-guard.ts";
import { buildProduction } from "../../../src/build/production-build/index.ts";
import { TestDataFactory } from "../../fixtures/test-data-factory.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

describe(
  "ProductionServer",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    afterAll(async () => {
      await cleanupBundler();
      restoreLogs();
    });

    describe(
      "Production Server - Static Assets",
      { sanitizeResources: false, sanitizeOps: false },
      () => {
        it("serves static files with correct headers", async () => {
          await withTestContext("prod-static-assets", async (context) => {
            context.setEnv({ VF_CACHE_ALLOW_CLOSE: "1" });

            await writeTextFile(
              join(context.projectDir, "public", "test.txt"),
              "This is a test static file",
            );
            await writeTextFile(
              join(context.projectDir, "public", "styles.css"),
              "body { margin: 0; }",
            );

            await buildProduction({
              projectDir: context.projectDir,
              outputDir: join(context.projectDir, "dist"),
              enableSplitting: false,
              enableCompression: false,
              enablePrefetch: false,
            });

            const server = await context.createProductionServer();

            const txtResponse = await fetch(`http://127.0.0.1:${server.port}/test.txt`);
            const txtContent = await txtResponse.text();

            assertEquals(txtResponse.status, 200, "Should serve text files");
            assertEquals(txtContent, "This is a test static file", "Should serve correct content");

            const cacheControl = txtResponse.headers.get("cache-control");
            assert(
              cacheControl === "public, max-age=3600" ||
                cacheControl === "no-cache, no-store, must-revalidate",
              `Should include cache control header, got: ${cacheControl}`,
            );

            const cssResponse = await fetch(`http://127.0.0.1:${server.port}/styles.css`);
            const cssContent = await cssResponse.text();

            assertEquals(cssResponse.status, 200, "Should serve CSS files");
            assertEquals(cssContent, "body { margin: 0; }", "Should serve correct CSS");
            assertEquals(
              cssResponse.headers.get("content-type"),
              "text/css; charset=utf-8",
              "Should set correct content-type for CSS",
            );
          });
        });

        it("handles 404 for missing files", async () => {
          await withTestContext("production-basic-404", async (context) => {
            const server = await context.createProductionServer();

            const res = await fetch(`http://127.0.0.1:${server.port}/missing.txt`);
            assertEquals(res.status, 404);
            await res.text();
          });
        });

        it("handles concurrent requests efficiently", async () => {
          await withTestContext("prod-concurrent", async (context) => {
            for (let i = 0; i < 5; i++) {
              await writeTextFile(
                join(context.projectDir, "public", `file${i}.txt`),
                `Content ${i}`,
              );
            }

            const server = await context.createProductionServer();

            const start = performance.now();
            const responses = await Promise.all(
              Array.from(
                { length: 5 },
                (_, i) => fetch(`http://127.0.0.1:${server.port}/file${i}.txt`),
              ),
            );
            const duration = performance.now() - start;

            for (const [i, response] of responses.entries()) {
              assertEquals(response.status, 200, `Request ${i} should succeed`);
              assertEquals(
                await response.text(),
                `Content ${i}`,
                `Should return correct content for file ${i}`,
              );
            }

            assert(
              duration < 200,
              `Should handle 5 concurrent requests within 200ms, took ${duration.toFixed(2)}ms`,
            );
          });
        });
      },
    );

    describe(
      "Production Server - App Router",
      { sanitizeResources: false, sanitizeOps: false },
      () => {
        it("serves App Router pages with layouts", async () => {
          await withTestContext("prod-app-router", async (context) => {
            context.setEnv({ VF_CACHE_ALLOW_CLOSE: "1" });

            await mkdir(join(context.projectDir, "app"), { recursive: true });
            await writeTextFile(
              join(context.projectDir, "app", "layout.tsx"),
              TestDataFactory.createAppLayout(),
            );
            await writeTextFile(
              join(context.projectDir, "app", "page.tsx"),
              `export default function HomePage() {
          return <h1>App Router Home</h1>;
        }`,
            );

            await buildProduction({
              projectDir: context.projectDir,
              outputDir: join(context.projectDir, "dist"),
              enableSplitting: false,
              enableCompression: false,
              enablePrefetch: false,
            });

            const server = await context.createProductionServer();
            const response = await fetch(`http://127.0.0.1:${server.port}/`);
            const html = await response.text();

            assertEquals(response.status, 200, "Should serve App Router pages");
            assert(html.includes("App Router Home"), "Should render page content");
            assert(html.includes("<html"), "Should include layout wrapper");
          });
        });
      },
    );

    describe(
      "Production Server - API Routes",
      { sanitizeResources: false, sanitizeOps: false },
      () => {
        it("handles API routes", async () => {
          await withTestContext("production-basic-api", async (context) => {
            await mkdir(join(context.projectDir, "app", "api", "hello"), { recursive: true });
            await writeTextFile(
              join(context.projectDir, "app", "api", "hello", "route.ts"),
              `export function GET() {
            return Response.json({ message: "Hello API" });
          }`,
            );

            const server = await context.createProductionServer();

            const res = await fetch(`http://127.0.0.1:${server.port}/api/hello`);
            assertEquals(res.status, 200);
            assertEquals((await res.json()).message, "Hello API");
          });
        });
      },
    );

    describe(
      "Production Server - Security",
      { sanitizeResources: false, sanitizeOps: false },
      () => {
        it("does not set CSP by default (allows user content)", async () => {
          await withTestContext("prod-csp-nonce", async (context) => {
            await writeTextFile(
              join(context.projectDir, "pages", "index.tsx"),
              `export default function Home() { return <h1>CSP Test</h1>; }`,
            );

            const server = await context.createProductionServer();

            const res = await fetch(`http://127.0.0.1:${server.port}/`);
            assertEquals(res.status, 200, "Should serve the page");
            assertEquals(
              res.headers.get("content-security-policy"),
              null,
              "CSP should not be set by default",
            );
            await res.text();
          });
        });

        it("sets security headers", async () => {
          await withTestContext("production-basic-security", async (context) => {
            await writeTextFile(
              join(context.projectDir, "app", "page.tsx"),
              `export default function Page() { return <div>Security Test</div>; }`,
            );

            const server = await context.createProductionServer();

            const res = await fetch(`http://127.0.0.1:${server.port}/`);
            assertEquals(res.status, 200);
            assertEquals(res.headers.get("x-content-type-options"), "nosniff");
            await res.text();
          });
        });

        it("sets basic security headers by default", async () => {
          await withTestContext("prod-security-headers", async (context) => {
            const server = await context.createProductionServer();
            const response = await fetch(`http://127.0.0.1:${server.port}/`);

            assertEquals(
              response.headers.get("x-content-type-options"),
              "nosniff",
              "Should prevent MIME sniffing",
            );
            assertEquals(
              response.headers.get("x-frame-options"),
              "DENY",
              "Should prevent framing by default",
            );
            assertEquals(
              response.headers.get("content-security-policy"),
              null,
              "CSP not set by default to allow user content",
            );

            await response.text();
          });
        });

        it("handles CORS preflight requests", async () => {
          await withTestContext("prod-cors-preflight", async (context) => {
            await mkdir(join(context.projectDir, "pages", "api"), { recursive: true });
            await writeTextFile(
              join(context.projectDir, "pages", "api", "hello.ts"),
              `export const GET = () => Response.json({ message: "Hello" });`,
            );

            const server = await context.createProductionServer();
            const response = await fetch(`http://127.0.0.1:${server.port}/api/hello`, {
              method: "OPTIONS",
            });

            assertEquals(response.status, 204, "Should return 204 for preflight");
            assertExists(
              response.headers.get("access-control-allow-origin"),
              "Should include CORS headers",
            );

            await response.body?.cancel();
          });
        });
      },
    );

    describe(
      "Production Server - Pages Router",
      { sanitizeResources: false, sanitizeOps: false },
      () => {
        it("renders MDX pages with frontmatter", async () => {
          await withTestContext("prod-mdx-rendering", async (context) => {
            const mdxContent = TestDataFactory.createMDXPage({
              title: "Test Page",
              content: "This is a **test** page with *emphasis*.",
              frontmatter: {
                author: "Test Author",
                date: "2024-01-01",
              },
            });

            await writeTextFile(join(context.projectDir, "pages", "test.mdx"), mdxContent);

            const server = await context.createProductionServer();

            const response = await fetch(`http://127.0.0.1:${server.port}/test`);
            const html = await response.text();

            assertEquals(response.status, 200, "Should render MDX page");
            assert(html.includes("Test Page") || html.includes("<h1>"), "Should render page title");
          });
        });
      },
    );

    describe(
      "Production Server - Error Handling",
      { sanitizeResources: false, sanitizeOps: false },
      () => {
        it("returns 404 page for non-existent routes", async () => {
          await withTestContext("prod-404-page", async (context) => {
            context.setEnv({ VF_CACHE_ALLOW_CLOSE: "1" });

            await writeTextFile(
              join(context.projectDir, "pages", "index.tsx"),
              `export default function Home() { return <h1>Home</h1>; }`,
            );

            await buildProduction({
              projectDir: context.projectDir,
              outputDir: join(context.projectDir, "dist"),
              enableSplitting: false,
              enableCompression: false,
              enablePrefetch: false,
            });

            const server = await context.createProductionServer();

            const response = await fetch(`http://127.0.0.1:${server.port}/non-existent-page`);
            const html = await response.text();

            assertEquals(response.status, 404, "Should return 404 status");
            assert(
              html.includes("Page Not Found") || html.includes("404"),
              "Should show 404 message",
            );
            assert(
              html.includes("non-existent-page") || html.includes("/non-existent-page"),
              "Should include requested path",
            );
          });
        });

        it("handles errors securely in production mode", async () => {
          await withTestContext("prod-error-security", async (context) => {
            context.setEnv({ VF_CACHE_ALLOW_CLOSE: "1", NODE_ENV: "production" });

            await writeTextFile(
              join(context.projectDir, "pages", "error.mdx"),
              `# Error Page\n\n<UndefinedComponent />`,
            );

            const server = await context.createProductionServer();
            const response = await fetch(`http://127.0.0.1:${server.port}/error`);
            await response.text();

            assert(
              response.status === 404 || response.status === 500,
              `Should return error status (got ${response.status})`,
            );
          });
        });
      },
    );
  },
);
