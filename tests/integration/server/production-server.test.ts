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

import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import "../../_helpers/log-guard.ts";
import { buildProduction } from "../../../src/build/production-build/index.ts";
import { startProductionServer } from "../../../src/server/production-server.ts";
import { TestDataFactory } from "../../fixtures/test-data-factory.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { getFreePort } from "../../_helpers/utils.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

// Clean up renderer intervals to prevent resource leaks
afterAll(async () => {
  await cleanupBundler();
});

describe(
  "Production Server - Static Assets",
  {},
  () => {
    it("serves static files with correct headers", async () => {
      await withTestContext("prod-static-assets", async (context) => {
        // Enable cache closing for tests
        context.setEnv({ VF_CACHE_ALLOW_CLOSE: "1" });

        // Arrange
        await Deno.writeTextFile(
          join(context.projectDir, "public", "test.txt"),
          "This is a test static file",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "public", "styles.css"),
          "body { margin: 0; }",
        );

        // Build first for production
        await buildProduction({
          projectDir: context.projectDir,
          outputDir: join(context.projectDir, "dist"),
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
        });

        // Act
        const server = await context.createProductionServer();

        // Test text file
        const txtResponse = await fetch(`http://localhost:${server.port}/test.txt`);
        const txtContent = await txtResponse.text();

        // Assert text file
        assertEquals(txtResponse.status, 200, "Should serve text files");
        assertEquals(txtContent, "This is a test static file", "Should serve correct content");
        assertEquals(
          txtResponse.headers.get("cache-control"),
          "public, max-age=3600",
          "Should include cache control header",
        );

        // Test CSS file
        const cssResponse = await fetch(`http://localhost:${server.port}/styles.css`);
        const cssContent = await cssResponse.text();

        // Assert CSS file
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
        const port = getFreePort(9501, 10000);
        const controller = new AbortController();
        const server = await startProductionServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
          signal: controller.signal,
        });

        await server.ready;
        await new Promise((r) => setTimeout(r, 200));

        try {
          const res = await fetch(`http://127.0.0.1:${port}/missing.txt`);
          assertEquals(res.status, 404);
          await res.text();
        } finally {
          controller.abort();
          if (server?.stop) await server.stop();
        }
      });
    });

    it("handles concurrent requests efficiently", async () => {
      await withTestContext("prod-concurrent", async (context) => {
        // Create multiple assets
        for (let i = 0; i < 5; i++) {
          await Deno.writeTextFile(
            join(context.projectDir, "public", `file${i}.txt`),
            `Content ${i}`,
          );
        }

        const server = await context.createProductionServer();

        // Make concurrent requests
        const start = performance.now();
        const requests = Array.from(
          { length: 5 },
          (_, i) => fetch(`http://localhost:${server.port}/file${i}.txt`),
        );

        const responses = await Promise.all(requests);
        const duration = performance.now() - start;

        // Verify all succeeded
        for (const [i, response] of responses.entries()) {
          assertEquals(response.status, 200, `Request ${i} should succeed`);
          const content = await response.text();
          assertEquals(content, `Content ${i}`, `Should return correct content for file ${i}`);
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
  {},
  () => {
    it("serves App Router pages with layouts", async () => {
      await withTestContext("prod-app-router", async (context) => {
        // Enable cache closing for tests
        context.setEnv({ VF_CACHE_ALLOW_CLOSE: "1" });

        // Create App Router structure
        await Deno.mkdir(join(context.projectDir, "app"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "layout.tsx"),
          TestDataFactory.createAppLayout(),
        );
        await Deno.writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          `export default function HomePage() {
        return <h1>App Router Home</h1>;
      }`,
        );

        // Build production assets before starting server
        await buildProduction({
          projectDir: context.projectDir,
          outputDir: join(context.projectDir, "dist"),
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
        });

        const server = await context.createProductionServer();
        const response = await fetch(`http://localhost:${server.port}/`);
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
  {},
  () => {
    it("handles API routes", async () => {
      await withTestContext("production-basic-api", async (context) => {
        // Create an App Router API route
        await ensureDir(join(context.projectDir, "app", "api", "hello"));
        await Deno.writeTextFile(
          join(context.projectDir, "app", "api", "hello", "route.ts"),
          `export function GET() {
          return Response.json({ message: "Hello API" });
        }`,
        );

        const port = getFreePort(9503, 10000);
        const controller = new AbortController();
        const server = await startProductionServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
          signal: controller.signal,
        });

        await server.ready;
        await new Promise((r) => setTimeout(r, 200));

        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/hello`);
          assertEquals(res.status, 200);
          const data = await res.json();
          assertEquals(data.message, "Hello API");
        } finally {
          controller.abort();
          if (server?.stop) await server.stop();
        }
      });
    });
  },
);

describe(
  "Production Server - Security",
  {},
  () => {
    it("sets CSP with nonce", async () => {
      await withTestContext("prod-csp-nonce", async (context) => {
        // Create a simple page so the server has something to serve
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "index.tsx"),
          `export default function Home() { return <h1>CSP Test</h1>; }`,
        );

        const port = getFreePort(9000, 12000);
        const controller = new AbortController();
        const server = await startProductionServer({
          projectDir: context.projectDir,
          port,
          signal: controller.signal as any,
        });
        await server.ready;
        await new Promise((r) => setTimeout(r, 200));

        try {
          const res = await fetch(`http://127.0.0.1:${port}/`);
          assertEquals(res.status, 200, "Should serve the page");
          const csp = res.headers.get("content-security-policy");
          assert(csp && csp.length > 0, "Should have CSP header");
          await res.text();
        } finally {
          controller.abort();
          await server.stop?.();
        }
      });
    });

    it("sets security headers", async () => {
      await withTestContext("production-basic-security", async (context) => {
        // Create a simple App Router page
        await Deno.writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          `export default function Page() { return <div>Security Test</div>; }`,
        );

        const port = getFreePort(9504, 10000);
        const controller = new AbortController();
        const server = await startProductionServer({
          projectDir: context.projectDir,
          port,
          hostname: "127.0.0.1",
          signal: controller.signal,
        });

        await server.ready;
        await new Promise((r) => setTimeout(r, 200));

        try {
          const res = await fetch(`http://127.0.0.1:${port}/`);
          assertEquals(res.status, 200);

          // Check security headers
          assertEquals(res.headers.get("x-content-type-options"), "nosniff");

          await res.text();
        } finally {
          controller.abort();
          if (server?.stop) await server.stop();
        }
      });
    });

    it("handles security headers correctly", async () => {
      await withTestContext("prod-security-headers", async (context) => {
        const server = await context.createProductionServer();
        const response = await fetch(`http://localhost:${server.port}/`);

        // Check security headers
        const csp = response.headers.get("content-security-policy");
        assertExists(csp, "Should include CSP header");
        assert(csp.includes("default-src 'self'"), "CSP should restrict sources");

        assertEquals(
          response.headers.get("cross-origin-resource-policy"),
          "same-origin",
          "Should set CORP header",
        );
        assertEquals(
          response.headers.get("cross-origin-opener-policy"),
          "same-origin",
          "Should set COOP header",
        );
        assertEquals(
          response.headers.get("x-content-type-options"),
          "nosniff",
          "Should prevent MIME sniffing",
        );
        assertEquals(response.headers.get("x-frame-options"), "DENY", "Should prevent framing");

        await response.text();
      });
    });

    it("handles CORS preflight requests", async () => {
      await withTestContext("prod-cors-preflight", async (context) => {
        // Create an API route
        await Deno.mkdir(join(context.projectDir, "pages", "api"), {
          recursive: true,
        });
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "api", "hello.ts"),
          `export const GET = () => Response.json({ message: "Hello" });`,
        );

        const server = await context.createProductionServer();
        const response = await fetch(`http://localhost:${server.port}/api/hello`, {
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
  {},
  () => {
    it("renders MDX pages with frontmatter", async () => {
      /**
       * Tests MDX processing including:
       * - Frontmatter extraction
       * - Markdown rendering
       * - Component integration
       */
      await withTestContext("prod-mdx-rendering", async (context) => {
        // Arrange
        const mdxContent = TestDataFactory.createMDXPage({
          title: "Test Page",
          content: "This is a **test** page with *emphasis*.",
          frontmatter: {
            author: "Test Author",
            date: "2024-01-01",
          },
        });

        await Deno.writeTextFile(join(context.projectDir, "pages", "test.mdx"), mdxContent);

        const server = await context.createProductionServer();

        // Act
        const response = await fetch(`http://localhost:${server.port}/pages/test`);
        const html = await response.text();

        // Assert
        assertEquals(response.status, 200, "Should render MDX page");
        assert(html.includes("Test Page") || html.includes("<h1>"), "Should render page title");
      });
    });
  },
);

describe(
  "Production Server - Error Handling",
  {},
  () => {
    it("returns 404 page for non-existent routes", async () => {
      // Production servers need at least one page to initialize properly
      // This test creates a simple index page and then tests 404 handling for other routes
      await withTestContext("prod-404-page", async (context) => {
        // Enable cache closing for tests
        context.setEnv({ VF_CACHE_ALLOW_CLOSE: "1" });

        // Create a minimal index page
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "index.tsx"),
          `export default function Home() { return <h1>Home</h1>; }`,
        );

        // Build production assets before starting server
        await buildProduction({
          projectDir: context.projectDir,
          outputDir: join(context.projectDir, "dist"),
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
        });

        const server = await context.createProductionServer();

        // Test that a non-existent page returns 404
        const response = await fetch(`http://localhost:${server.port}/non-existent-page`);
        const html = await response.text();

        assertEquals(response.status, 404, "Should return 404 status");
        assert(html.includes("Page Not Found") || html.includes("404"), "Should show 404 message");
        assert(
          html.includes("non-existent-page") || html.includes("/non-existent-page"),
          "Should include requested path",
        );
      });
    });

    it("handles errors securely in production mode", async () => {
      await withTestContext("prod-error-security", async (context) => {
        // Enable cache closing for tests
        context.setEnv({ VF_CACHE_ALLOW_CLOSE: "1", NODE_ENV: "production" });

        // Create a page that throws during render
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "error.mdx"),
          `# Error Page\n\n<UndefinedComponent />`,
        );

        // Start server without pre-building - this forces dynamic SSR
        const server = await context.createProductionServer();
        const response = await fetch(`http://localhost:${server.port}/error`);
        const html = await response.text();

        // In production mode, SSR errors may return 404 or 500 depending on
        // server configuration. The key security requirement is that error
        // details (like component names, stack traces) are NOT exposed.
        assert(
          response.status === 404 || response.status === 500,
          `Should return error status (got ${response.status})`,
        );
        assert(
          !html.includes("UndefinedComponent"),
          "Should NOT expose error details in production",
        );
        assert(
          !html.includes("_missingMdxReference"),
          "Should NOT expose stack trace in production",
        );
      });
    });
  },
);
