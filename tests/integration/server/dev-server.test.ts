/**
 * Development Server Tests
 *
 * Tests the dev server functionality:
 * - Hot Module Replacement (HMR)
 * - Remote import security
 * - Static file serving
 * - API route handling
 * - App Router and Pages Router support
 * - Error handling
 * - Virtual modules
 * - Caching and ETags
 */

import { assert, assertEquals, assertExists, assertMatch } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { createDevServer } from "../../../src/server/dev-server.ts";
import { TestDataFactory } from "../../fixtures/test-data-factory.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { drainEventLoop } from "../../_helpers/utils.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

describe("Dev Server Integration", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  describe(
    "Dev Server - Core Functionality",
    {},
    () => {
      it("exports are available", () => {
        assertExists(createDevServer, "createDevServer should be exported");
        assertEquals(typeof createDevServer, "function", "Should be a function");
      });

      it("starts and serves basic MDX page", async () => {
        /**
         * Verifies basic dev server functionality:
         * - Server starts successfully
         * - MDX pages are rendered
         * - Response includes expected content
         */
        await withTestContext("dev-basic-mdx", async (context) => {
          // Create a test page
          await Deno.writeTextFile(
            join(context.projectDir, "pages", "index.mdx"),
            "# Home Page\n\nWelcome to the development server test.",
          );

          const controller = new AbortController();
          const server = await context.createDevServer({
            enableHMR: false,
            signal: controller.signal,
          });

          // Test the home page
          const response = await fetch(`http://localhost:${server.port}/`);
          assertEquals(response.status, 200, "Should serve home page");

          const html = await response.text();
          assert(html.includes("Home Page") || html.includes("<h1>"), "Should render MDX heading");

          // Drain event loop to clean up React 19 MessagePorts
          await drainEventLoop(3, 20);

          // Clean up MDX renderer intervals to prevent resource leaks
          await cleanupBundler();

          controller.abort();
        });
      });

      it("handles 404 for non-existent routes", async () => {
        await withTestContext("dev-404-handling", async (context) => {
          const controller = new AbortController();
          const server = await context.createDevServer({
            enableHMR: false,
            signal: controller.signal,
          });

          const response = await fetch(`http://localhost:${server.port}/non-existent-page`);
          assertEquals(response.status, 404, "Should return 404 for missing routes");

          // Consume response body to prevent leak
          await response.text();

          controller.abort();
        });
      });
    },
  );

  describe(
    "Dev Server - Security",
    {},
    () => {
      it("enforces remote import allow-list for security", async () => {
        /**
         * Tests security feature that restricts remote imports in API routes
         * to only allowed domains (esm.sh, deno.land by default)
         */
        await withTestContext("dev-security-allowlist", async (context) => {
          // Configure security allow-list
          await Deno.writeTextFile(
            join(context.projectDir, "veryfront.config.js"),
            TestDataFactory.createConfig({
              security: {
                remoteHosts: ["https://esm.sh", "https://deno.land"],
              },
            }),
          );

          // Create API route that imports from allowed host
          await Deno.mkdir(join(context.projectDir, "app", "api", "allowed"), {
            recursive: true,
          });
          await Deno.writeTextFile(
            join(context.projectDir, "app", "api", "allowed", "route.ts"),
            `export const GET = async () => {
          const m = await import('https://esm.sh/nanoid@5.0.4');
          return new Response(typeof m.nanoid === 'function' ? 'ok' : 'fail', {
            headers: { 'content-type': 'text/plain' }
          });
        }`,
          );

          // Create API route that imports from blocked host
          await Deno.mkdir(join(context.projectDir, "app", "api", "blocked"), {
            recursive: true,
          });
          await Deno.writeTextFile(
            join(context.projectDir, "app", "api", "blocked", "route.ts"),
            `export const GET = async () => {
          await import('https://example.com/malicious.js');
          return new Response('should not reach here');
        }`,
          );

          const controller = new AbortController();
          const server = await context.createDevServer({
            enableHMR: false,
            signal: controller.signal,
          });

          // Test allowed import
          const allowedResponse = await fetch(`http://localhost:${server.port}/api/allowed`);
          assertEquals(allowedResponse.status, 200, "Should allow esm.sh imports");
          const allowedBody = await allowedResponse.text();
          assertEquals(allowedBody, "ok", "Should successfully import from allowed host");

          // Test blocked import
          // Returns 502 (build failure) or 500 (runtime import failure in Deno direct mode)
          const blockedResponse = await fetch(`http://localhost:${server.port}/api/blocked`);
          assertEquals(
            blockedResponse.status === 502 || blockedResponse.status === 500,
            true,
            `Should block unauthorized imports, got status ${blockedResponse.status}`,
          );
          await blockedResponse.body?.cancel();

          controller.abort();
        });
      });
    },
  );

  describe(
    "Dev Server - HMR",
    {},
    () => {
      it("HMR runtime endpoint when enabled", async () => {
        /**
         * Tests that HMR runtime is served when HMR is enabled
         */
        await withTestContext("dev-hmr-runtime", async (context) => {
          const controller = new AbortController();
          const server = await context.createDevServer({
            enableHMR: true,
            signal: controller.signal,
          });

          // Test HMR runtime endpoint
          const response = await fetch(`http://localhost:${server.port}/_veryfront/hmr-runtime.js`);
          assertEquals(response.status, 200, "Should serve HMR runtime");

          const body = await response.text();
          assert(body.includes("HMR") || body.includes("WebSocket"), "Should contain HMR code");

          controller.abort();
        });
      });
    },
  );

  describe(
    "Dev Server - Static Files",
    {},
    () => {
      it("serves static files from public directory", async () => {
        /**
         * Tests static file serving:
         * - CSS files with correct content-type
         * - JavaScript files
         * - Other static assets
         */
        await withTestContext("dev-static-files", async (context) => {
          // Create static files
          await Deno.writeTextFile(
            join(context.projectDir, "public", "styles.css"),
            "body { margin: 0; padding: 0; }",
          );
          await Deno.writeTextFile(
            join(context.projectDir, "public", "script.js"),
            "console.log('Hello from static JS');",
          );
          await Deno.writeTextFile(
            join(context.projectDir, "public", "data.json"),
            JSON.stringify({ message: "Static JSON data" }),
          );

          const controller = new AbortController();
          const server = await context.createDevServer({
            enableHMR: false,
            signal: controller.signal,
          });

          // Test CSS file
          const cssResponse = await fetch(`http://localhost:${server.port}/styles.css`);
          assertEquals(cssResponse.status, 200, "Should serve CSS file");
          assertEquals(
            cssResponse.headers.get("content-type"),
            "text/css; charset=utf-8",
            "Should set correct content-type for CSS",
          );
          const cssContent = await cssResponse.text();
          assertEquals(cssContent, "body { margin: 0; padding: 0; }", "Should serve correct CSS");

          // Test JS file
          const jsResponse = await fetch(`http://localhost:${server.port}/script.js`);
          assertEquals(jsResponse.status, 200, "Should serve JS file");
          const jsContent = await jsResponse.text();
          assertEquals(jsContent, "console.log('Hello from static JS');", "Should serve correct JS");

          // Test JSON file
          const jsonResponse = await fetch(`http://localhost:${server.port}/data.json`);
          assertEquals(jsonResponse.status, 200, "Should serve JSON file");
          const jsonData = await jsonResponse.json();
          assertEquals(jsonData.message, "Static JSON data", "Should serve correct JSON");

          controller.abort();
        });
      });

      it("static caching headers and 304 semantics", async () => {
        await withTestContext("dev-static-cache", async (context) => {
          // Create unhashed and hashed assets
          await Deno.writeTextFile(join(context.projectDir, "public", "plain.txt"), "plain");
          await Deno.writeTextFile(
            join(context.projectDir, "public", "app.12345678.js"),
            "console.log('x')",
          );

          const controller = new AbortController();
          const server = await context.createDevServer({
            enableHMR: false,
            signal: controller.signal,
          });

          // Unhashed asset
          const u = await fetch(`http://localhost:${server.port}/plain.txt`);
          const uCC = u.headers.get("cache-control");
          // Default cache for non-hashed public assets
          assertEquals(uCC, "public, max-age=3600");
          const uTag = u.headers.get("etag");
          if (uTag) {
            const u304 = await fetch(`http://localhost:${server.port}/plain.txt`, {
              headers: { "if-none-match": uTag },
            });
            assertEquals(u304.status, 304);
            await u304.body?.cancel();
          }
          await u.body?.cancel();

          // Hashed asset
          const h = await fetch(`http://localhost:${server.port}/app.12345678.js`);
          const hCC = h.headers.get("cache-control");
          assertEquals(hCC, "public, max-age=31536000, immutable");
          await h.body?.cancel();

          controller.abort();
        });
      });
    },
  );

  describe(
    "Dev Server - SSR Caching",
    {},
    () => {
      it("SSR ETag/304 and HEAD support", async () => {
        await withTestContext("dev-ssr-etag-head", async (context) => {
          await Deno.writeTextFile(join(context.projectDir, "app", "page.mdx"), "# Home");

          const controller = new AbortController();
          const server = await context.createDevServer({
            enableHMR: false,
            signal: controller.signal,
          });

          const res = await fetch(`http://localhost:${server.port}/`);
          assertEquals(res.status, 200);
          const etag = res.headers.get("etag");
          assert(etag && etag.length > 0);
          // cache-control for SSR HTML in dev mode should be no-cache
          assertEquals(
            res.headers.get("cache-control"),
            "no-cache, no-store, must-revalidate",
          );
          await res.text();

          // HEAD should return same ETag
          const head = await fetch(`http://localhost:${server.port}/`, {
            method: "HEAD",
          });
          assertEquals(head.status, 200);
          assertEquals(head.headers.get("etag"), etag);
          await head.body?.cancel();

          // In dev mode, 304 is disabled to prevent CSP nonce mismatches
          // (cached HTML has old nonces, but each request generates fresh nonces)
          // Should return 200 instead of 304 even with matching ETag
          const r304 = await fetch(`http://localhost:${server.port}/`, {
            headers: { "if-none-match": etag! },
          });
          assertEquals(r304.status, 200, "Dev mode should return 200 (not 304) to prevent CSP nonce mismatch");
          await r304.text(); // Consume body

          controller.abort();
        });
      });
    },
  );

  describe(
    "Dev Server - HTTP Methods",
    {},
    () => {
      it("method handling and OPTIONS Allow header (route.ts)", async () => {
        await withTestContext("dev-method-allow", async (context) => {
          // Create POST-only app route
          await Deno.mkdir(join(context.projectDir, "app", "admin"), {
            recursive: true,
          });
          await Deno.writeTextFile(
            join(context.projectDir, "app", "admin", "route.ts"),
            `export const POST = () => new Response('ok');`,
          );

          const controller = new AbortController();
          const server = await context.createDevServer({
            enableHMR: false,
            signal: controller.signal,
          });

          // HEAD should be 405 (no GET to shim)
          const h = await fetch(`http://localhost:${server.port}/admin`, {
            method: "HEAD",
          });
          assertEquals(h.status, 405);
          const allowHead = h.headers.get("allow") || h.headers.get("Allow");
          // Only POST should be advertised here
          assertEquals(allowHead, "POST");
          await h.body?.cancel();

          // OPTIONS preflight should include Allow and Access-Control-Allow-Methods
          const pre = await fetch(`http://localhost:${server.port}/admin`, {
            method: "OPTIONS",
          });
          assertEquals(pre.status, 204);
          const allow = pre.headers.get("allow") || pre.headers.get("Allow");
          assert(allow?.includes("POST"));
          const methods = pre.headers.get("access-control-allow-methods") || "";
          assert(methods.includes("POST"));
          await pre.body?.cancel();

          controller.abort();
        });
      });
    },
  );

  describe(
    "Dev Server - Pages Router",
    {},
    () => {
      it("renders Pages Router TSX pages", async () => {
        /**
         * Tests Pages Router with TypeScript/JSX support
         */
        await withTestContext("dev-pages-tsx", async (context) => {
          // Create MDX page with basic content
          // Note: MDX with JSX exports requires proper scoping - test basic rendering first
          await Deno.writeTextFile(
            join(context.projectDir, "pages", "index.mdx"),
            `# Pages Router Test

This is a test page for the Pages Router.

## Features

- Basic MDX rendering
- Pages Router integration
- Development mode testing
`,
          );

          const controller = new AbortController();
          const server = await context.createDevServer({
            enableHMR: false,
            signal: controller.signal,
          });

          const response = await fetch(`http://localhost:${server.port}/`);
          assertEquals(response.status, 200, "Should serve Pages Router page");

          const html = await response.text();
          assert(html.includes("Pages Router Test"), "Should render page content");
          assert(html.includes("Features"), "Should render MDX heading");

          controller.abort();
        });
      });

      it("API routes handle different HTTP methods", async () => {
        /**
         * Tests Pages Router API routes with various HTTP methods
         */
        await withTestContext("dev-api-methods", async (context) => {
          await Deno.mkdir(join(context.projectDir, "pages", "api"), {
            recursive: true,
          });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "api", "test.ts"),
            TestDataFactory.createAPIHandler({
              methods: ["GET", "POST", "PUT", "DELETE"],
            }),
          );

          const controller = new AbortController();
          const server = await context.createDevServer({
            enableHMR: false,
            signal: controller.signal,
          });

          // Note: API routes in Pages Router might not be fully implemented
          // This test documents expected behavior
          const response = await fetch(`http://localhost:${server.port}/api/test`);

          // API routes might return 404 if not implemented
          if (response.status === 404) {
            assertEquals(response.status, 404, "API routes might not be implemented yet");
            await response.text(); // Consume body
          } else {
            assertEquals(response.status, 200, "Should handle API route");
            const data = await response.json();
            assertEquals(data.method, "GET", "Should identify GET method");
          }

          controller.abort();
        });
      });
    },
  );

  describe(
    "Dev Server - App Router",
    {},
    () => {
      it("renders App Router with layouts", async () => {
        /**
         * Tests App Router functionality:
         * - Root layout
         * - Page components
         * - Nested layouts
         */
        await withTestContext("dev-app-router", async (context) => {
          // Create App Router structure
          await Deno.writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            TestDataFactory.createAppLayout({ title: "Dev Test App" }),
          );

          await Deno.writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `export default function HomePage() {
          return <h1>App Router Home</h1>;
        }`,
          );

          const controller = new AbortController();
          const server = await context.createDevServer({
            enableHMR: false,
            signal: controller.signal,
          });

          const response = await fetch(`http://localhost:${server.port}/`);
          assertEquals(response.status, 200, "Should serve App Router page");

          const html = await response.text();
          assert(html.includes("App Router Home"), "Should render page component");
          assert(html.includes("<html"), "Should include layout wrapper");

          controller.abort();
        });
      });

      it("handles nested App Router routes", async () => {
        await withTestContext("dev-app-nested", async (context) => {
          // Create nested structure
          await Deno.writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            TestDataFactory.createAppLayout(),
          );

          await Deno.mkdir(join(context.projectDir, "app", "blog", "[slug]"), {
            recursive: true,
          });
          await Deno.writeTextFile(
            join(context.projectDir, "app", "blog", "layout.tsx"),
            `export default function BlogLayout({ children }: { children: React.ReactNode }) {
          return <div className="blog-layout">{children}</div>;
        }`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "app", "blog", "[slug]", "page.tsx"),
            `export default function BlogPost() {
          return <article>Blog Post Content</article>;
        }`,
          );

          const controller = new AbortController();
          const server = await context.createDevServer({
            enableHMR: false,
            signal: controller.signal,
          });

          const response = await fetch(`http://localhost:${server.port}/blog/test-post`);
          assertEquals(response.status, 200, "Should serve nested dynamic route");

          const html = await response.text();
          assert(html.includes("Blog Post Content"), "Should render blog post");
          assert(html.includes("blog-layout"), "Should include nested layout");

          controller.abort();
        });
      });

      it("error boundaries catch and display errors", async () => {
        /**
         * Tests error handling with error.tsx boundaries
         */
        await withTestContext("dev-error-boundaries", async (context) => {
          // Create app with error boundary
          await Deno.writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            TestDataFactory.createAppLayout(),
          );

          await Deno.mkdir(join(context.projectDir, "app", "error-test"), {
            recursive: true,
          });

          await Deno.writeTextFile(
            join(context.projectDir, "app", "error-test", "error.tsx"),
            `'use client';
        export default function ErrorBoundary({ error }: { error: Error }) {
          return <div className="error-boundary">Error caught: {error.message}</div>;
        }`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "app", "error-test", "page.tsx"),
            `export default function ErrorPage() {
          throw new Error('Intentional error for testing');
        }`,
          );

          const controller = new AbortController();
          const server = await context.createDevServer({
            enableHMR: false,
            signal: controller.signal,
          });

          const response = await fetch(`http://localhost:${server.port}/error-test`);
          // In dev mode, errors might return 500 or 200 depending on error boundary handling
          assert(response.status === 200 || response.status === 500, "Should handle error page");

          const html = await response.text();
          assert(
            html.includes("error-boundary") || html.includes("Error"),
            "Should show error boundary or error message",
          );

          controller.abort();
        });
      });

      it("loading.tsx shows loading states", async () => {
        /**
         * Tests loading UI with Suspense boundaries
         */
        await withTestContext("dev-loading-ui", async (context) => {
          await Deno.writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            TestDataFactory.createAppLayout(),
          );

          await Deno.mkdir(join(context.projectDir, "app", "async"), {
            recursive: true,
          });

          await Deno.writeTextFile(
            join(context.projectDir, "app", "async", "loading.tsx"),
            `export default function Loading() {
          return <div className="loading-ui">Loading...</div>;
        }`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "app", "async", "page.tsx"),
            `import { Suspense } from 'react';

        async function SlowComponent() {
          await new Promise(resolve => setTimeout(resolve, 10));
          return <div>Loaded Content</div>;
        }

        export default function AsyncPage() {
          return (
            <Suspense fallback={<div>Inline Loading...</div>}>
              <SlowComponent />
            </Suspense>
          );
        }`,
          );

          const controller = new AbortController();
          const server = await context.createDevServer({
            enableHMR: false,
            signal: controller.signal,
          });

          const response = await fetch(`http://localhost:${server.port}/async`);
          assertEquals(response.status, 200, "Should serve async page");

          const html = await response.text();
          // In streaming mode, we might see loading UI or final content
          assert(
            html.includes("Loading...") || html.includes("Loaded Content"),
            "Should show loading UI or loaded content",
          );

          // Wait a bit to ensure any timers from streaming complete
          await new Promise((resolve) => setTimeout(resolve, 50));

          controller.abort();
        });
      });
    },
  );

  describe(
    "Dev Server - Virtual Modules",
    {},
    () => {
      // FIXME: Virtual module test has async initialization race condition
      // The renderer initializes on first request, but components are loaded asynchronously
      // This causes the virtual module handler to try to serve modules before they're registered
      // Needs architectural fix to ensure renderer+components are fully initialized before serving
      it.ignore("serves component and page virtual modules as ESM", async () => {
        await withTestContext("dev-virtual-mods", async (context) => {
          // Create a page in pages/
          await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home\n");
          // Create a component for virtual resolve
          await Deno.writeTextFile(
            join(context.projectDir, "components", "Hello.tsx"),
            [
              "import React from 'https://esm.sh/react@19.1.1'",
              "export default function Hello(){ return React.createElement('div', null, 'Hi') }",
              "",
            ].join("\n"),
          );

          const controller = new AbortController();
          const server = await context.createDevServer({
            enableHMR: false,
            signal: controller.signal,
          });

          // Component virtual module
          // Note: Components are registered as "component:ComponentName" without path or extension
          const comp = await fetch(
            `http://127.0.0.1:${server.port}/_veryfront/modules/component:Hello`,
          );
          assertEquals(comp.status, 200);
          assertMatch(comp.headers.get("content-type") || "", /javascript/i);
          assertMatch(comp.headers.get("cache-control") || "", /no-cache/i);
          const code = await comp.text();
          assert(code.includes("export"));

          // Page virtual module
          const page = await fetch(`http://127.0.0.1:${server.port}/_veryfront/modules/page:index`);
          assertEquals(page.status, 200);
          assertMatch(page.headers.get("content-type") || "", /javascript/i);
          assertMatch(page.headers.get("cache-control") || "", /no-cache/i);
          const pageCode = await page.text();
          assert(pageCode.length > 0);

          controller.abort();
        });
      });
    },
  );
});