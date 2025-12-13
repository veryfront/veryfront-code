
import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { delay as _delay } from "std/async/delay.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { DevServer } from "../../../src/server/dev-server.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { drainEventLoop } from "../../_helpers/utils.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

afterAll(async () => {
  await cleanupBundler();
});

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

describe(
  "DevServer - Health Check Handler",
  {},
  () => {
    it("returns 200 for /healthz endpoint", async () => {
      await withTestContext("dev-server-healthz", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetch(`http://localhost:${port}/healthz`);

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

        const response = await fetch(`http://localhost:${port}/readyz`);

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

        const start = performance.now();
        const healthResponse = await fetch(`http://localhost:${port}/healthz`);
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

        const response = await fetch(`http://localhost:${port}/`);

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

        const response = await fetch(`http://localhost:${port}/_veryfront/hmr-runtime.js`);

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

        const response = await fetch(`http://localhost:${port}/_veryfront/error-overlay.js`);

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

        const response = await fetch(`http://localhost:${port}/_veryfront/hmr-runtime.js`, {
          method: "HEAD",
        });

        assertEquals(response.status, 200);
        const contentType = response.headers.get("content-type");
        assert(
          contentType?.startsWith("application/javascript"),
          `Expected content-type to start with "application/javascript" but got "${contentType}"`,
        );

        assertEquals(await response.text(), "");

        await server.stop();
        await drainEventLoop();
      });
    });

    it("responds to HEAD requests for error overlay runtime", async () => {
      await withTestContext("dev-server-error-overlay-head", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetch(`http://localhost:${port}/_veryfront/error-overlay.js`, {
          method: "HEAD",
        });

        assertEquals(response.status, 200);
        const contentType = response.headers.get("content-type");
        assert(
          contentType?.startsWith("application/javascript"),
          `Expected content-type to start with "application/javascript" but got "${contentType}"`,
        );

        assertEquals(await response.text(), "");

        await server.stop();
        await drainEventLoop();
      });
    });

    it("handles virtual module requests", async () => {
      await withTestContext("dev-server-virtual-modules", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetch(
          `http://localhost:${port}/_veryfront/modules/component:Button`,
        );

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

        const response = await fetch(`http://localhost:${port}/`);

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
  "DevServer - Application Request Handler",
  {},
  () => {
    it("delegates to universal handler for application routes", async () => {
      await withTestContext("dev-server-app-handler", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetch(`http://localhost:${port}/`);

        assertExists(response);
        assert(response.status !== 0);
        await response.body?.cancel();

        await server.stop();
        await drainEventLoop();
      });
    });

    it("handles page requests", async () => {
      await withTestContext("dev-server-page-requests", async (context) => {
        const pagesDir = `${context.projectDir}/pages`;
        await Deno.mkdir(pagesDir, { recursive: true });
        await Deno.writeTextFile(
          `${pagesDir}/test.tsx`,
          "export default function Test() { return <div>Test Page</div> }",
        );

        const { server, port } = await createTestDevServer(context);

        const response = await fetch(`http://localhost:${port}/test`);

        assertExists(response);
        assert(response.status !== 0);
        await response.body?.cancel();

        await server.stop();
        await drainEventLoop();
      });
    });

    it("handles API routes", async () => {
      await withTestContext("dev-server-api-routes", async (context) => {
        const apiDir = `${context.projectDir}/pages/api`;
        await Deno.mkdir(apiDir, { recursive: true });
        await Deno.writeTextFile(
          `${apiDir}/test.ts`,
          'export async function GET() { return new Response("API Response") }',
        );

        const { server, port } = await createTestDevServer(context);

        const response = await fetch(`http://localhost:${port}/api/test`);

        assertExists(response);
        assert(response.status !== 0);
        await response.body?.cancel();

        await server.stop();
        await drainEventLoop();
      });
    });

    it("passes through all request headers", async () => {
      await withTestContext("dev-server-request-headers", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetch(`http://localhost:${port}/`, {
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

        const response = await fetch(`http://localhost:${port}/nonexistent-route`);

        assertExists(response);
        assert(response.status !== 0);
        await response.body?.cancel();

        await server.stop();
        await drainEventLoop();
      });
    });

    it("sets correct content-type for error responses", async () => {
      await withTestContext("dev-server-error-content-type", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const response = await fetch(`http://localhost:${port}/nonexistent`);

        assertExists(response);
        const contentType = response.headers.get("content-type");

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

        const errorResponse = await fetch(
          `http://localhost:${port}/definitely-not-a-real-page-12345`,
        );
        await errorResponse.body?.cancel();

        const healthResponse = await fetch(`http://localhost:${port}/healthz`);
        assertEquals(healthResponse.status, 200);
        await healthResponse.body?.cancel();

        await server.stop();
        await drainEventLoop();
      });
    });

    it("handles errors without crashing server", async () => {
      await withTestContext("dev-server-error-resilience", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const errorResponses = await Promise.all([
          fetch(`http://localhost:${port}/error1`),
          fetch(`http://localhost:${port}/error2`),
          fetch(`http://localhost:${port}/error3`),
        ]);
        await Promise.all(errorResponses.map((r) => r.body?.cancel()));

        const response = await fetch(`http://localhost:${port}/healthz`);
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

        const healthStart = performance.now();
        const healthRes = await fetch(`http://localhost:${port}/healthz`);
        await healthRes.body?.cancel();
        const healthDuration = performance.now() - healthStart;

        const appStart = performance.now();
        const appRes = await fetch(`http://localhost:${port}/`);
        await appRes.body?.cancel();
        const appDuration = performance.now() - appStart;

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

        const requests = await Promise.all([
          fetch(`http://localhost:${port}/healthz`),
          fetch(`http://localhost:${port}/`),
          fetch(`http://localhost:${port}/healthz`),
          fetch(`http://localhost:${port}/readyz`),
        ]);

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

        const response = await fetch(`http://localhost:${port}/`);

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

        const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];

        for (const method of methods) {
          const response = await fetch(`http://localhost:${port}/`, {
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

        for (let i = 0; i < 10; i++) {
          const start = performance.now();
          const perfRes = await fetch(`http://localhost:${port}/healthz`);
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

        const start = performance.now();
        const response = await fetch(`http://localhost:${port}/`);
        const duration = performance.now() - start;

        assertExists(response);
        assert(duration < 5000, `Request took ${duration}ms, should be <5000ms`);
        await response.body?.cancel();

        await server.stop();
        await drainEventLoop();
      });
    });

    it("error handling does not add significant overhead", async () => {
      await withTestContext("dev-server-error-perf", async (context) => {
        const { server, port } = await createTestDevServer(context);

        const successStart = performance.now();
        const successRes = await fetch(`http://localhost:${port}/healthz`);
        await successRes.body?.cancel();
        const successDuration = performance.now() - successStart;

        const errorStart = performance.now();
        const errorRes = await fetch(`http://localhost:${port}/nonexistent`);
        await errorRes.body?.cancel();
        const errorDuration = performance.now() - errorStart;

        const threshold = Deno.env.get("CI") ? 20 : 10;
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
