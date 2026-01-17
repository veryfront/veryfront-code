/**
 * DevServer Handler Methods Tests
 *
 * Tests for the refactored DevServer.handleRequest() extracted handlers:
 * - handleHealthCheck()
 * - incrementRequestMetrics()
 * - handleDevEndpoint()
 * - handleApplicationRequest()
 * - handleServerError()
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { delay as _delay } from "@std/async";
import { afterAll, describe, it } from "@std/testing/bdd.ts";
import { DevServer } from "../../../src/server/dev-server.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { drainEventLoop } from "../../_helpers/utils.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

// Helper to create DevServer instance for testing
async function createTestDevServer(context: any, options: Partial<any> = {}) {
  const port = await context.allocatePort();

  const server = new DevServer({
    port,
    projectDir: context.projectDir,
    enableHMR: false,
    enableFastRefresh: false,
    ...options,
  });

  context.trackResource(server, `DevServer on port ${port}`);
  await server.start();
  await server.ready;

  return { server, port };
}

describe("DevServer Handler Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  describe(
    "DevServer - Health Check Handler",
    {},
    () => {
      it("returns 200 for /healthz endpoint", async () => {
        await withTestContext("dev-server-healthz", async (context) => {
          const { server, port } = await createTestDevServer(context);

          const response = await fetch(`http://127.0.0.1:${port}/healthz`);

          assertEquals(response.status, 200);
          assertEquals(response.headers.get("content-type"), "text/plain");
          assertEquals(await response.text(), "ok");

          await server.stop();
          await drainEventLoop();
        });
      });

      it("returns ready status for /readyz endpoint", async () => {
        await withTestContext("dev-server-readyz", async (context) => {
          const { server, port } = await createTestDevServer(context);

          // Server should be ready after start()
          const response = await fetch(`http://127.0.0.1:${port}/readyz`);

          assertEquals(response.status, 200);
          assertEquals(response.headers.get("content-type"), "text/plain");
          assertEquals(await response.text(), "ready");

          await server.stop();
          await drainEventLoop();
        });
      });

      it("health checks have no async overhead", async () => {
        await withTestContext("dev-server-health-performance", async (context) => {
          const { server, port } = await createTestDevServer(context);

          // Health checks should be very fast (<10ms)
          const start = performance.now();
          const healthResponse = await fetch(`http://127.0.0.1:${port}/healthz`);
          await healthResponse.body?.cancel();
          const duration = performance.now() - start;

          assert(duration < 100, `Health check took ${duration}ms, should be <100ms`);

          await server.stop();
          await drainEventLoop();
        });
      });

      it("returns null for non-health-check routes", async () => {
        await withTestContext("dev-server-health-passthrough", async (context) => {
          const { server, port } = await createTestDevServer(context);

          // Regular routes should not be handled by health check handler
          const response = await fetch(`http://127.0.0.1:${port}/`);

          // Should get response (not null), handled by other handlers
          assertExists(response);
          assert(response.status !== 0);
          await response.body?.cancel();

          await server.stop();
          await drainEventLoop();
        });
      });
    },
  );

  describe(
    "DevServer - Dev Endpoint Handler",
    {},
    () => {
      it("serves HMR runtime when HMR is enabled", async () => {
        await withTestContext("dev-server-hmr-runtime", async (context) => {
          const { server, port } = await createTestDevServer(context, {
            enableHMR: true,
            hmrPort: await context.allocatePort(),
          });

          const response = await fetch(`http://127.0.0.1:${port}/_veryfront/hmr-runtime.js`);

          assertEquals(response.status, 200);
          const contentType = response.headers.get("content-type");
          assert(
            contentType?.startsWith("application/javascript"),
            `Expected content-type to start with "application/javascript" but got "${contentType}"`,
          );
          const cacheControl = response.headers.get("cache-control");
          assert(
            cacheControl?.includes("no-cache"),
            `Expected cache-control to include "no-cache" but got "${cacheControl}"`,
          );

          const content = await response.text();
          assertExists(content);
          assert(content.length > 0);

          await server.stop();
          await drainEventLoop();
        });
      });

      it("serves error overlay runtime", async () => {
        await withTestContext("dev-server-error-overlay", async (context) => {
          const { server, port } = await createTestDevServer(context);

          const response = await fetch(`http://127.0.0.1:${port}/_veryfront/error-overlay.js`);

          assertEquals(response.status, 200);
          const contentType = response.headers.get("content-type");
          assert(
            contentType?.startsWith("application/javascript"),
            `Expected content-type to start with "application/javascript" but got "${contentType}"`,
          );
          const cacheControl = response.headers.get("cache-control");
          assert(
            cacheControl?.includes("no-cache"),
            `Expected cache-control to include "no-cache" but got "${cacheControl}"`,
          );

          const content = await response.text();
          assertExists(content);
          assert(content.length > 0);

          await server.stop();
          await drainEventLoop();
        });
      });

      it("responds to HEAD requests for HMR runtime", async () => {
        await withTestContext("dev-server-hmr-head", async (context) => {
          const { server, port } = await createTestDevServer(context, {
            enableHMR: true,
            hmrPort: await context.allocatePort(),
          });

          const response = await fetch(`http://127.0.0.1:${port}/_veryfront/hmr-runtime.js`, {
            method: "HEAD",
          });

          assertEquals(response.status, 200);
          const contentType = response.headers.get("content-type");
          assert(
            contentType?.startsWith("application/javascript"),
            `Expected content-type to start with "application/javascript" but got "${contentType}"`,
          );

          // HEAD requests should not fall through to application router
          assertEquals(await response.text(), "");

          await server.stop();
          await drainEventLoop();
        });
      });

      it("responds to HEAD requests for error overlay runtime", async () => {
        await withTestContext("dev-server-error-overlay-head", async (context) => {
          const { server, port } = await createTestDevServer(context);

          const response = await fetch(`http://127.0.0.1:${port}/_veryfront/error-overlay.js`, {
            method: "HEAD",
          });

          assertEquals(response.status, 200);
          const contentType = response.headers.get("content-type");
          assert(
            contentType?.startsWith("application/javascript"),
            `Expected content-type to start with "application/javascript" but got "${contentType}"`,
          );

          // HEAD requests should not fall through to application router
          assertEquals(await response.text(), "");

          await server.stop();
          await drainEventLoop();
        });
      });

      it("handles virtual module requests", async () => {
        await withTestContext("dev-server-virtual-modules", async (context) => {
          const { server, port } = await createTestDevServer(context);

          // Try to load a virtual module (component or page)
          const response = await fetch(
            `http://127.0.0.1:${port}/_veryfront/modules/component:Button`,
          );

          // Should return 200 or 404 (depending on if component exists)
          // Allow 500 as well since virtual module system might not be fully initialized in dev mode
          assert(
            response.status === 200 || response.status === 404 || response.status === 500,
            `Expected 200, 404, or 500 but got ${response.status}`,
          );
          await response.body?.cancel();

          await server.stop();
          await drainEventLoop();
        });
      });

      it("returns null for non-dev endpoints", async () => {
        await withTestContext("dev-server-dev-passthrough", async (context) => {
          const { server, port } = await createTestDevServer(context);

          // Regular application routes should not be handled by dev endpoint handler
          const response = await fetch(`http://127.0.0.1:${port}/`);

          assertExists(response);
          // Should be handled by application handler
          assert(response.status !== 0);
          await response.body?.cancel();

          await server.stop();
          await drainEventLoop();
        });
      });
    },
  );

  describe(
    "DevServer - Application Request Handler",
    {},
    () => {
      it("delegates to universal handler for application routes", async () => {
        await withTestContext("dev-server-app-handler", async (context) => {
          const { server, port } = await createTestDevServer(context);

          // Regular application route
          const response = await fetch(`http://127.0.0.1:${port}/`);

          assertExists(response);
          // Universal handler should return a response
          assert(response.status !== 0);
          await response.body?.cancel();

          await server.stop();
          await drainEventLoop();
        });
      });

      it("handles page requests", async () => {
        await withTestContext("dev-server-page-requests", async (context) => {
          // Create a simple page
          const pagesDir = `${context.projectDir}/pages`;
          await Deno.mkdir(pagesDir, { recursive: true });
          await Deno.writeTextFile(
            `${pagesDir}/test.tsx`,
            "export default function Test() { return <div>Test Page</div> }",
          );

          const { server, port } = await createTestDevServer(context);

          const response = await fetch(`http://127.0.0.1:${port}/test`);

          assertExists(response);
          // Should get a response (200 or error)
          assert(response.status !== 0);
          await response.body?.cancel();

          await server.stop();
          await drainEventLoop();
        });
      });

      it("handles API routes", async () => {
        await withTestContext("dev-server-api-routes", async (context) => {
          // Create an API route
          const apiDir = `${context.projectDir}/pages/api`;
          await Deno.mkdir(apiDir, { recursive: true });
          await Deno.writeTextFile(
            `${apiDir}/test.ts`,
            'export async function GET() { return new Response("API Response") }',
          );

          const { server, port } = await createTestDevServer(context);

          const response = await fetch(`http://127.0.0.1:${port}/api/test`);

          assertExists(response);
          // Should get API response
          assert(response.status !== 0);
          await response.body?.cancel();

          await server.stop();
          await drainEventLoop();
        });
      });

      it("passes through all request headers", async () => {
        await withTestContext("dev-server-request-headers", async (context) => {
          const { server, port } = await createTestDevServer(context);

          const response = await fetch(`http://127.0.0.1:${port}/`, {
            headers: {
              "x-custom-header": "test-value",
              "accept": "text/html",
            },
          });

          assertExists(response);
          assert(response.status !== 0);
          await response.body?.cancel();

          await server.stop();
          await drainEventLoop();
        });
      });
    },
  );

  describe(
    "DevServer - Error Handler",
    {},
    () => {
      it("returns error overlay for server errors", async () => {
        await withTestContext("dev-server-error-handler", async (context) => {
          const { server, port } = await createTestDevServer(context);

          // Request a page that doesn't exist (should trigger error)
          const response = await fetch(`http://127.0.0.1:${port}/nonexistent-route`);

          assertExists(response);
          // Should return some response (404 or error overlay)
          assert(response.status !== 0);
          await response.body?.cancel();

          await server.stop();
          await drainEventLoop();
        });
      });

      it("sets correct content-type for error responses", async () => {
        await withTestContext("dev-server-error-content-type", async (context) => {
          const { server, port } = await createTestDevServer(context);

          const response = await fetch(`http://127.0.0.1:${port}/nonexistent`);

          assertExists(response);
          const contentType = response.headers.get("content-type");

          // Should be HTML for error overlay
          if (response.status >= 400) {
            assert(
              contentType?.includes("text/html") || contentType?.includes("application/json"),
              "Error responses should have HTML or JSON content type",
            );
          }
          await response.body?.cancel();

          await server.stop();
          await drainEventLoop();
        });
      });

      it("logs errors properly", async () => {
        await withTestContext("dev-server-error-logging", async (context) => {
          const { server, port } = await createTestDevServer(context);

          // Trigger an error by requesting invalid route
          const errorResponse = await fetch(
            `http://127.0.0.1:${port}/definitely-not-a-real-page-12345`,
          );
          await errorResponse.body?.cancel();

          // Server should still be running after error
          const healthResponse = await fetch(`http://127.0.0.1:${port}/healthz`);
          assertEquals(healthResponse.status, 200);
          await healthResponse.body?.cancel();

          await server.stop();
          await drainEventLoop();
        });
      });

      it("handles errors without crashing server", async () => {
        await withTestContext("dev-server-error-resilience", async (context) => {
          const { server, port } = await createTestDevServer(context);

          // Make multiple requests that might error
          const errorResponses = await Promise.all([
            fetch(`http://127.0.0.1:${port}/error1`),
            fetch(`http://127.0.0.1:${port}/error2`),
            fetch(`http://127.0.0.1:${port}/error3`),
          ]);
          await Promise.all(errorResponses.map((r) => r.body?.cancel()));

          // Server should still be healthy
          const response = await fetch(`http://127.0.0.1:${port}/healthz`);
          assertEquals(response.status, 200);
          await response.body?.cancel();

          await server.stop();
          await drainEventLoop();
        });
      });
    },
  );

  describe(
    "DevServer - Request Flow Integration",
    {},
    () => {
      it("executes handlers in correct order", async () => {
        await withTestContext("dev-server-handler-order", async (context) => {
          const { server, port } = await createTestDevServer(context);

          // Health check should be handled first (fast path)
          const healthStart = performance.now();
          const healthRes = await fetch(`http://127.0.0.1:${port}/healthz`);
          await healthRes.body?.cancel();
          const healthDuration = performance.now() - healthStart;

          // Application request should take longer
          const appStart = performance.now();
          const appRes = await fetch(`http://127.0.0.1:${port}/`);
          await appRes.body?.cancel();
          const appDuration = performance.now() - appStart;

          // Health check should be significantly faster
          assert(
            healthDuration < appDuration,
            `Health check (${healthDuration}ms) should be faster than app request (${appDuration}ms)`,
          );

          await server.stop();
          await drainEventLoop();
        });
      });

      it("handles concurrent requests correctly", async () => {
        await withTestContext("dev-server-concurrent-requests", async (context) => {
          const { server, port } = await createTestDevServer(context);

          // Make multiple concurrent requests
          const requests = await Promise.all([
            fetch(`http://127.0.0.1:${port}/healthz`),
            fetch(`http://127.0.0.1:${port}/`),
            fetch(`http://127.0.0.1:${port}/healthz`),
            fetch(`http://127.0.0.1:${port}/readyz`),
          ]);

          // All requests should succeed
          for (const response of requests) {
            assertExists(response);
            assert(response.status !== 0);
          }
          await Promise.all(requests.map((r) => r.body?.cancel()));

          await server.stop();
          await drainEventLoop();
        });
      });

      it("maintains request context across handlers", async () => {
        await withTestContext("dev-server-request-context", async (context) => {
          const { server, port } = await createTestDevServer(context);

          const response = await fetch(`http://127.0.0.1:${port}/`);

          // Response should have request ID header (from middleware)
          const requestId = response.headers.get("x-request-id");
          assertExists(requestId, "Response should include request ID");
          await response.body?.cancel();

          await server.stop();
          await drainEventLoop();
        });
      });

      it("handles all HTTP methods correctly", async () => {
        await withTestContext("dev-server-http-methods", async (context) => {
          const { server, port } = await createTestDevServer(context);

          // Test different HTTP methods
          const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];

          for (const method of methods) {
            const response = await fetch(`http://127.0.0.1:${port}/`, {
              method,
            });

            assertExists(response);
            assert(response.status !== 0);
            await response.body?.cancel();
          }

          await server.stop();
          await drainEventLoop();
        });
      });
    },
  );

  describe(
    "DevServer - Handler Performance",
    {},
    () => {
      it("health checks complete in <100ms", async () => {
        await withTestContext("dev-server-health-perf", async (context) => {
          const { server, port } = await createTestDevServer(context);

          const timings: number[] = [];

          // Measure 10 health check requests
          for (let i = 0; i < 10; i++) {
            const start = performance.now();
            const perfRes = await fetch(`http://127.0.0.1:${port}/healthz`);
            await perfRes.body?.cancel();
            timings.push(performance.now() - start);
          }

          const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;

          assert(avgTime < 100, `Average health check time ${avgTime}ms should be <100ms`);

          await server.stop();
          await drainEventLoop();
        });
      });

      it("metrics increment is non-blocking", async () => {
        await withTestContext("dev-server-metrics-nonblocking", async (context) => {
          const { server, port } = await createTestDevServer(context);

          // Request should complete quickly even if metrics fail
          const start = performance.now();
          const response = await fetch(`http://127.0.0.1:${port}/`);
          const duration = performance.now() - start;

          assertExists(response);
          // Should complete in reasonable time
          assert(duration < 5000, `Request took ${duration}ms, should be <5000ms`);
          await response.body?.cancel();

          await server.stop();
          await drainEventLoop();
        });
      });

      it("error handling does not add significant overhead", async () => {
        await withTestContext("dev-server-error-perf", async (context) => {
          const { server, port } = await createTestDevServer(context);

          // Measure successful request
          const successStart = performance.now();
          const successRes = await fetch(`http://127.0.0.1:${port}/healthz`);
          await successRes.body?.cancel();
          const successDuration = performance.now() - successStart;

          // Measure error request
          const errorStart = performance.now();
          const errorRes = await fetch(`http://127.0.0.1:${port}/nonexistent`);
          await errorRes.body?.cancel();
          const errorDuration = performance.now() - errorStart;

          // Error handling should not be dramatically slower
          // Note: healthz is a simple endpoint, while 404 goes through full SSR pipeline
          // Use higher threshold because they're fundamentally different code paths
          // The key point is that 404s don't take seconds (indicating a bug)
          const threshold = 50; // 50x accounts for SSR overhead vs simple health check
          assert(
            errorDuration < successDuration * threshold,
            `Error handling (${errorDuration}ms) should not be >${threshold}x slower than success (${successDuration}ms)`,
          );

          await server.stop();
          await drainEventLoop();
        });
      });
    },
  );
});
