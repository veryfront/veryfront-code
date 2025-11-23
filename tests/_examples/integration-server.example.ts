/**
 * EXAMPLE: Integration Test with Server
 *
 * This file demonstrates proper integration testing patterns with servers.
 * Use this as a template for tests that require server setup.
 */

import { assertEquals, assertExists } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { withTestContext } from "../_helpers/context.ts";
import { TEST_TIMEOUTS } from "../_helpers/constants.ts";

/**
 * Example: Testing a dev server with TestContext
 */
describe("Example Integration Test - Dev Server", () => {
  it(
    "should start dev server and serve content",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      /**
       * TestContext automatically handles:
       * - Temp directory creation
       * - Port allocation
       * - Server cleanup
       * - Environment variable restoration
       */
      await withTestContext("dev-server-example", async (context) => {
        // Arrange: Set up test environment
        const projectDir = context.projectDir;

        // Create a test page
        await Deno.writeTextFile(
          `${projectDir}/pages/index.tsx`,
          `export default function Home() { return <div>Hello World</div>; }`,
        );

        // Act: Start the server
        const server = await context.createDevServer({
          enableHMR: false,
        });

        assertExists(server.port, "Server should have a port assigned");

        // Make a request to the server
        const response = await fetch(`http://localhost:${server.port}/`);

        // Assert: Verify response
        assertEquals(
          response.status,
          200,
          "Server should respond with 200 OK",
        );

        const html = await response.text();
        assertExists(html, "Should return HTML content");
        assertEquals(
          html.includes("Hello World"),
          true,
          "HTML should contain page content",
        );

        // Cleanup is automatic - no need to call server.stop()
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

/**
 * Example: Testing production server
 */
describe("Example Integration Test - Production Server", () => {
  it(
    "should serve static assets with cache headers",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      await withTestContext("production-server-example", async (context) => {
        // Arrange: Create static asset
        const publicDir = `${context.projectDir}/public`;
        await Deno.mkdir(publicDir, { recursive: true });
        await Deno.writeTextFile(
          `${publicDir}/style.css`,
          "body { margin: 0; }",
        );

        // Act: Start production server
        const server = await context.createProductionServer();

        const response = await fetch(
          `http://localhost:${server.port}/style.css`,
        );

        // Assert
        assertEquals(
          response.status,
          200,
          "Should serve static file",
        );

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

/**
 * Example: Testing with environment variables
 */
describe("Example Integration Test - Environment Variables", () => {
  it(
    "should use custom environment variables",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      await withTestContext("env-vars-example", async (context) => {
        // Set environment variables (automatically restored after test)
        context.setEnv({
          TEST_MODE: "enabled",
          API_KEY: "test-key-123",
        });

        // Verify environment variables are set
        assertEquals(
          Deno.env.get("TEST_MODE"),
          "enabled",
          "Environment variable should be set",
        );

        const server = await context.createDevServer();
        assertExists(server, "Server should start with custom env vars");

        // After the test, env vars are automatically restored
      });

      // Verify cleanup: env var should be restored
      assertEquals(
        Deno.env.get("TEST_MODE"),
        undefined,
        "Environment variables should be cleaned up",
      );
    },
  );
});

/**
 * Example: Testing concurrent requests
 */
describe("Example Integration Test - Concurrent Requests", () => {
  it(
    "should handle multiple concurrent requests",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      await withTestContext("concurrent-requests", async (context) => {
        // Create test pages
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

        // Make concurrent requests
        const responses = await Promise.all([
          fetch(`${baseUrl}/page1`),
          fetch(`${baseUrl}/page2`),
          fetch(`${baseUrl}/page1`),
          fetch(`${baseUrl}/page2`),
        ]);

        // All requests should succeed
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

/**
 * Example: Testing error scenarios
 */
describe("Example Integration Test - Error Handling", () => {
  it(
    "should handle malformed requests gracefully",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      await withTestContext("error-handling", async (context) => {
        const server = await context.createDevServer();

        // Send request with invalid headers (simulated)
        const response = await fetch(
          `http://localhost:${server.port}/`,
          {
            headers: {
              "Content-Type": "invalid/type",
            },
          },
        );

        // Server should still respond
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

/**
 * Example: Using cleanup handlers
 */
describe("Example Integration Test - Custom Cleanup", () => {
  it(
    "should run custom cleanup handlers",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      let cleanupCalled = false;

      await withTestContext("custom-cleanup", async (context) => {
        // Add custom cleanup handler
        context.addCleanup(async () => {
          cleanupCalled = true;
          await Deno.writeTextFile("/tmp/cleanup-test.txt", "cleaned up");
        });

        const server = await context.createDevServer();
        assertExists(server, "Server should start");

        // Test runs normally...
      });

      // Verify cleanup was called
      assertEquals(cleanupCalled, true, "Custom cleanup should be called");

      // Clean up our test file
      try {
        await Deno.remove("/tmp/cleanup-test.txt");
      } catch {
        // Ignore if already removed
      }
    },
  );
});

/**
 * Best Practices Checklist for Integration Tests:
 * ✅ Always use withTestContext for automatic cleanup
 * ✅ Set appropriate timeouts (TEST_TIMEOUTS.INTEGRATION)
 * ✅ Test both success and error scenarios
 * ✅ Use descriptive test names
 * ✅ Verify server responses thoroughly
 * ✅ Test concurrent operations when relevant
 * ✅ Clean up resources even if test fails (TestContext handles this)
 * ✅ Use meaningful assertion messages
 * ✅ Keep tests independent (no shared state between tests)
 */
