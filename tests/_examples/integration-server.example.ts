/*******************************************************
 * EXAMPLE: Integration Test with Server
 *
 * This file demonstrates proper integration testing patterns with servers.
 * Use this as a template for tests that require server setup.
 *******************************************************/

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { TEST_TIMEOUTS } from "../_helpers/constants.ts";
import { withTestContext } from "../_helpers/context.ts";

describe("Example Integration Test - Dev Server", () => {
  it(
    "should start dev server and serve content",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      await withTestContext("dev-server-example", async (context) => {
        const projectDir = context.projectDir;

        await Deno.writeTextFile(
          `${projectDir}/pages/index.tsx`,
          `export default function Home() { return <div>Hello World</div>; }`,
        );

        const server = await context.createDevServer({ enableHMR: false });
        assertExists(server.port, "Server should have a port assigned");

        const response = await fetch(`http://localhost:${server.port}/`);

        assertEquals(response.status, 200, "Server should respond with 200 OK");

        const html = await response.text();
        assertExists(html, "Should return HTML content");
        assertEquals(
          html.includes("Hello World"),
          true,
          "HTML should contain page content",
        );
      });
    },
  );

  it(
    "should handle 404 for non-existent routes",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      await withTestContext("dev-server-404", async (context) => {
        const server = await context.createDevServer();

        const response = await fetch(
          `http://localhost:${server.port}/nonexistent`,
        );

        assertEquals(
          response.status,
          404,
          "Should return 404 for non-existent routes",
        );
      });
    },
  );
});

describe("Example Integration Test - Production Server", () => {
  it(
    "should serve static assets with cache headers",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      await withTestContext("production-server-example", async (context) => {
        const publicDir = `${context.projectDir}/public`;
        await Deno.mkdir(publicDir, { recursive: true });
        await Deno.writeTextFile(`${publicDir}/style.css`, "body { margin: 0; }");

        const server = await context.createProductionServer();

        const response = await fetch(
          `http://localhost:${server.port}/style.css`,
        );

        assertEquals(response.status, 200, "Should serve static file");

        const cacheControl = response.headers.get("cache-control");
        assertExists(
          cacheControl,
          "Static assets should include cache-control header",
        );

        const css = await response.text();
        assertEquals(
          css.includes("margin: 0"),
          true,
          "Should serve correct CSS content",
        );
      });
    },
  );
});

describe("Example Integration Test - Environment Variables", () => {
  it(
    "should use custom environment variables",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      await withTestContext("env-vars-example", async (context) => {
        context.setEnv({
          TEST_MODE: "enabled",
          API_KEY: "test-key-123",
        });

        assertEquals(
          Deno.env.get("TEST_MODE"),
          "enabled",
          "Environment variable should be set",
        );

        const server = await context.createDevServer();
        assertExists(server, "Server should start with custom env vars");
      });

      assertEquals(
        Deno.env.get("TEST_MODE"),
        undefined,
        "Environment variables should be cleaned up",
      );
    },
  );
});

describe("Example Integration Test - Concurrent Requests", () => {
  it(
    "should handle multiple concurrent requests",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      await withTestContext("concurrent-requests", async (context) => {
        await Deno.writeTextFile(
          `${context.projectDir}/pages/page1.tsx`,
          `export default () => <div>Page 1</div>`,
        );
        await Deno.writeTextFile(
          `${context.projectDir}/pages/page2.tsx`,
          `export default () => <div>Page 2</div>`,
        );

        const server = await context.createDevServer();
        const baseUrl = `http://localhost:${server.port}`;

        const responses = await Promise.all([
          fetch(`${baseUrl}/page1`),
          fetch(`${baseUrl}/page2`),
          fetch(`${baseUrl}/page1`),
          fetch(`${baseUrl}/page2`),
        ]);

        for (const response of responses) {
          assertEquals(
            response.status,
            200,
            "All concurrent requests should succeed",
          );
        }

        const [page1_1, page2_1, page1_2, page2_2] = await Promise.all(
          responses.map((r) => r.text()),
        );

        assertEquals(
          page1_1,
          page1_2,
          "Same page should return consistent content",
        );
        assertEquals(
          page2_1,
          page2_2,
          "Same page should return consistent content",
        );
      });
    },
  );
});

describe("Example Integration Test - Error Handling", () => {
  it(
    "should handle malformed requests gracefully",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      await withTestContext("error-handling", async (context) => {
        const server = await context.createDevServer();

        const response = await fetch(`http://localhost:${server.port}/`, {
          headers: { "Content-Type": "invalid/type" },
        });

        assertExists(response, "Server should respond even with invalid headers");
        assertEquals(
          response.status < 600,
          true,
          "Response status should be valid HTTP status",
        );
      });
    },
  );
});

describe("Example Integration Test - Custom Cleanup", () => {
  it(
    "should run custom cleanup handlers",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      let cleanupCalled = false;

      await withTestContext("custom-cleanup", async (context) => {
        context.addCleanup(async () => {
          cleanupCalled = true;
          await Deno.writeTextFile("/tmp/cleanup-test.txt", "cleaned up");
        });

        const server = await context.createDevServer();
        assertExists(server, "Server should start");
      });

      assertEquals(cleanupCalled, true, "Custom cleanup should be called");

      try {
        await Deno.remove("/tmp/cleanup-test.txt");
      } catch {
        // Ignore if already removed
      }
    },
  );
});
