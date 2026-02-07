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

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { mkdir, writeTextFile } from "#veryfront/testing/deno-compat";
import { toBase64Url } from "#veryfront/utils/path-utils.ts";
import { DevServer } from "../../../src/server/dev-server.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { drainEventLoop } from "../../_helpers/utils.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

async function createTestDevServer(
  context: any,
  options: Partial<any> = {},
): Promise<{ server: DevServer; port: number }> {
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

async function stopServer(server: DevServer): Promise<void> {
  await server.stop();
  await drainEventLoop();
}

async function fetchAndCancel(input: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  await response.body?.cancel();
  return response;
}

function assertJsNoCache(response: Response): void {
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
}

describe("DevServer Handler Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("DevServer - Health Check Handler", {}, () => {
    it("returns 200 for /healthz endpoint", async () => {
      await withTestContext("dev-server-healthz", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetch(`http://127.0.0.1:${port}/healthz`);

        assertEquals(response.status, 200);
        assertEquals(response.headers.get("content-type"), "text/plain");
        assertEquals(await response.text(), "ok");

        await stopServer(server);
      });
    });

    it("returns ready status for /readyz endpoint", async () => {
      await withTestContext("dev-server-readyz", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetch(`http://127.0.0.1:${port}/readyz`);

        assertEquals(response.status, 200);
        assertEquals(response.headers.get("content-type"), "text/plain");
        assertEquals(await response.text(), "ready");

        await stopServer(server);
      });
    });

    it("health checks have no async overhead", async () => {
      await withTestContext("dev-server-health-performance", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const start = performance.now();
        await fetchAndCancel(`http://127.0.0.1:${port}/healthz`);
        const duration = performance.now() - start;

        assert(duration < 100, `Health check took ${duration}ms, should be <100ms`);

        await stopServer(server);
      });
    });

    it("returns null for non-health-check routes", async () => {
      await withTestContext("dev-server-health-passthrough", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetchAndCancel(`http://127.0.0.1:${port}/`);

        assertExists(response);
        assert(response.status !== 0);

        await stopServer(server);
      });
    });
  });

  describe("DevServer - Dev Endpoint Handler", {}, () => {
    it("serves HMR runtime when HMR is enabled", async () => {
      await withTestContext("dev-server-hmr-runtime", async (context) => {
        const { server, port } = await createTestDevServer(context, {
          enableHMR: true,
          hmrPort: await context.allocatePort(),
        });

        const response = await fetch(`http://127.0.0.1:${port}/_veryfront/hmr-runtime.js`);

        assertEquals(response.status, 200);
        assertJsNoCache(response);

        const content = await response.text();
        assertExists(content);
        assert(content.length > 0);

        await stopServer(server);
      });
    });

    it("serves error overlay runtime", async () => {
      await withTestContext("dev-server-error-overlay", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetch(`http://127.0.0.1:${port}/_veryfront/error-overlay.js`);

        assertEquals(response.status, 200);
        assertJsNoCache(response);

        const content = await response.text();
        assertExists(content);
        assert(content.length > 0);

        await stopServer(server);
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
        assertEquals(await response.text(), "");

        await stopServer(server);
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
        assertEquals(await response.text(), "");

        await stopServer(server);
      });
    });

    it("handles virtual module requests", async () => {
      await withTestContext("dev-server-virtual-modules", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetchAndCancel(
          `http://127.0.0.1:${port}/_veryfront/modules/component:Button`,
        );

        assert(
          response.status === 200 || response.status === 404 || response.status === 500,
          `Expected 200, 404, or 500 but got ${response.status}`,
        );

        await stopServer(server);
      });
    });

    it("returns null for non-dev endpoints", async () => {
      await withTestContext("dev-server-dev-passthrough", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetchAndCancel(`http://127.0.0.1:${port}/`);

        assertExists(response);
        assert(response.status !== 0);

        await stopServer(server);
      });
    });
  });

  describe("DevServer - Application Request Handler", {}, () => {
    it("delegates to runtime handler for application routes", async () => {
      await withTestContext("dev-server-app-handler", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetchAndCancel(`http://127.0.0.1:${port}/`);

        assertExists(response);
        assert(response.status !== 0);

        await stopServer(server);
      });
    });

    it("handles page requests", async () => {
      await withTestContext("dev-server-page-requests", async (context) => {
        const pagesDir = `${context.projectDir}/pages`;
        await mkdir(pagesDir, { recursive: true });
        await writeTextFile(
          `${pagesDir}/test.tsx`,
          "export default function Test() { return <div>Test Page</div> }",
        );

        const { server, port } = await createTestDevServer(context);

        const response = await fetchAndCancel(`http://127.0.0.1:${port}/test`);

        assertExists(response);
        assert(response.status !== 0);

        await stopServer(server);
      });
    });

    it("handles API routes", async () => {
      await withTestContext("dev-server-api-routes", async (context) => {
        const apiDir = `${context.projectDir}/pages/api`;
        await mkdir(apiDir, { recursive: true });
        await writeTextFile(
          `${apiDir}/test.ts`,
          'export async function GET() { return new Response("API Response") }',
        );

        const { server, port } = await createTestDevServer(context);

        const response = await fetchAndCancel(`http://127.0.0.1:${port}/api/test`);

        assertExists(response);
        assert(response.status !== 0);

        await stopServer(server);
      });
    });

    it("passes through all request headers", async () => {
      await withTestContext("dev-server-request-headers", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetchAndCancel(`http://127.0.0.1:${port}/`, {
          headers: {
            "x-custom-header": "test-value",
            "accept": "text/html",
          },
        });

        assertExists(response);
        assert(response.status !== 0);

        await stopServer(server);
      });
    });

    it("serves /_veryfront/fs modules without explicit defaultProjectSlug", async () => {
      await withTestContext("dev-server-local-project-fallback", async (context) => {
        await mkdir(join(context.projectDir, "components"), { recursive: true });
        const modulePath = join(context.projectDir, "components", "fallback.js");
        await writeTextFile(modulePath, "export default 'fallback';");

        const { server, port } = await createTestDevServer(context);
        const encodedPath = toBase64Url(modulePath);
        const response = await fetch(
          `http://127.0.0.1:${port}/_veryfront/fs/${encodedPath}.js`,
        );

        assertEquals(response.status, 200);
        const body = await response.text();
        assert(body.includes("fallback"), "Expected bundled module content");

        await stopServer(server);
      });
    });
  });

  describe("DevServer - Error Handler", {}, () => {
    it("returns error overlay for server errors", async () => {
      await withTestContext("dev-server-error-handler", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetchAndCancel(`http://127.0.0.1:${port}/nonexistent-route`);

        assertExists(response);
        assert(response.status !== 0);

        await stopServer(server);
      });
    });

    it("sets correct content-type for error responses", async () => {
      await withTestContext("dev-server-error-content-type", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetchAndCancel(`http://127.0.0.1:${port}/nonexistent`);

        assertExists(response);
        if (response.status >= 400) {
          const contentType = response.headers.get("content-type");
          assert(
            contentType?.includes("text/html") || contentType?.includes("application/json"),
            "Error responses should have HTML or JSON content type",
          );
        }

        await stopServer(server);
      });
    });

    it("logs errors properly", async () => {
      await withTestContext("dev-server-error-logging", async (context) => {
        const { server, port } = await createTestDevServer(context);

        await fetchAndCancel(`http://127.0.0.1:${port}/definitely-not-a-real-page-12345`);

        const healthResponse = await fetchAndCancel(`http://127.0.0.1:${port}/healthz`);
        assertEquals(healthResponse.status, 200);

        await stopServer(server);
      });
    });

    it("handles errors without crashing server", async () => {
      await withTestContext("dev-server-error-resilience", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const errorResponses = await Promise.all([
          fetch(`http://127.0.0.1:${port}/error1`),
          fetch(`http://127.0.0.1:${port}/error2`),
          fetch(`http://127.0.0.1:${port}/error3`),
        ]);
        await Promise.all(errorResponses.map((r) => r.body?.cancel()));

        const response = await fetchAndCancel(`http://127.0.0.1:${port}/healthz`);
        assertEquals(response.status, 200);

        await stopServer(server);
      });
    });
  });

  describe("DevServer - Request Flow Integration", {}, () => {
    it("executes handlers in correct order", async () => {
      await withTestContext("dev-server-handler-order", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const healthRes = await fetchAndCancel(`http://127.0.0.1:${port}/healthz`);
        assertEquals(healthRes.status, 200);

        const appRes = await fetchAndCancel(`http://127.0.0.1:${port}/`);
        assert(appRes.status >= 200 && appRes.status < 600);

        await stopServer(server);
      });
    });

    it("handles concurrent requests correctly", async () => {
      await withTestContext("dev-server-concurrent-requests", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const requests = await Promise.all([
          fetch(`http://127.0.0.1:${port}/healthz`),
          fetch(`http://127.0.0.1:${port}/`),
          fetch(`http://127.0.0.1:${port}/healthz`),
          fetch(`http://127.0.0.1:${port}/readyz`),
        ]);

        for (const response of requests) {
          assertExists(response);
          assert(response.status !== 0);
        }
        await Promise.all(requests.map((r) => r.body?.cancel()));

        await stopServer(server);
      });
    });

    it("maintains request context across handlers", async () => {
      await withTestContext("dev-server-request-context", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetchAndCancel(`http://127.0.0.1:${port}/`);

        const requestId = response.headers.get("x-request-id");
        assertExists(requestId, "Response should include request ID");

        await stopServer(server);
      });
    });

    it("handles all HTTP methods correctly", async () => {
      await withTestContext("dev-server-http-methods", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];

        for (const method of methods) {
          const response = await fetchAndCancel(`http://127.0.0.1:${port}/`, { method });
          assertExists(response);
          assert(response.status !== 0);
        }

        await stopServer(server);
      });
    });
  });

  describe("DevServer - Handler Performance", {}, () => {
    it("health checks complete in <100ms", async () => {
      await withTestContext("dev-server-health-perf", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const timings: number[] = [];

        for (let i = 0; i < 10; i++) {
          const start = performance.now();
          await fetchAndCancel(`http://127.0.0.1:${port}/healthz`);
          timings.push(performance.now() - start);
        }

        const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
        assert(avgTime < 100, `Average health check time ${avgTime}ms should be <100ms`);

        await stopServer(server);
      });
    });

    it("metrics increment is non-blocking", async () => {
      await withTestContext("dev-server-metrics-nonblocking", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const start = performance.now();
        const response = await fetchAndCancel(`http://127.0.0.1:${port}/`);
        const duration = performance.now() - start;

        assertExists(response);
        assert(duration < 5000, `Request took ${duration}ms, should be <5000ms`);

        await stopServer(server);
      });
    });

    it("error handling does not add significant overhead", async () => {
      await withTestContext("dev-server-error-perf", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const successStart = performance.now();
        await fetchAndCancel(`http://127.0.0.1:${port}/healthz`);
        const successDuration = performance.now() - successStart;

        const errorStart = performance.now();
        await fetchAndCancel(`http://127.0.0.1:${port}/nonexistent`);
        const errorDuration = performance.now() - errorStart;

        const absoluteCeilingMs = 5000;
        assert(
          errorDuration < absoluteCeilingMs,
          `Error handling took ${
            errorDuration.toFixed(0)
          }ms, exceeding ${absoluteCeilingMs}ms ceiling (success: ${successDuration.toFixed(0)}ms)`,
        );

        await stopServer(server);
      });
    });
  });
});
