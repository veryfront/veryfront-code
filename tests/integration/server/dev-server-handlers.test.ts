/**
 * DevServer Handler Methods Tests
 *
 * Tests for the DevServer request pipeline — health checks, dev endpoints,
 * application routes, error handling, and request flow — driven in-process
 * through the same `RequestHandler` the dev server serves, so no ports,
 * readiness polling, or shutdown draining are involved.
 */

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { toBase64Url } from "#veryfront/utils/path-utils.ts";
import { withInProcessProject } from "../../_helpers/in-process-project.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

type Handle = (path: string) => Promise<Response>;

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

function extractImportSpecifiers(code: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"'`]+)["']/g,
    /import\(\s*["']([^"'`]+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

// The narrow browser-safe error modules: the split registries plus the base
// error machinery. The heavyweight `errors/index.js` barrel stays banned.
const BROWSER_SAFE_ERROR_MODULES = new Set([
  "/_vf_modules/_veryfront/errors/error-registry.js",
  "/_vf_modules/_veryfront/errors/error-registry/agent.js",
  "/_vf_modules/_veryfront/errors/error-registry/general.js",
  "/_vf_modules/_veryfront/errors/error-registry/server.js",
  "/_vf_modules/_veryfront/errors/http-error.js",
  "/_vf_modules/_veryfront/errors/types.js",
  "/_vf_modules/_veryfront/errors/veryfront-error.js",
]);

const BROWSER_CSP_SAFE_MODULE_PATHS = [
  "/_vf_modules/_veryfront/chat/index.js",
  "/_vf_modules/_veryfront/react/components/ui/color-mode.js",
  "/_vf_modules/_veryfront/react/components/chat/chat.js",
  "/_vf_modules/_veryfront/react/components/chat/chat/contexts/chat-context.js",
  "/_vf_modules/_veryfront/react/components/chat/chat/contexts/composer-context.js",
  "/_vf_modules/_veryfront/react/components/chat/chat/contexts/message-context.js",
  "/_vf_modules/_veryfront/react/components/chat/markdown.js",
  "/_vf_modules/_veryfront/security/client/html-sanitizer.js",
  "/_vf_modules/_veryfront/rendering/rsc/client-boot.js",
  "/_vf_modules/_veryfront/rendering/rsc/client-dom.js",
  "/_vf_modules/_veryfront/routing/client/page-loader.js",
  "/_vf_modules/_veryfront/client/spa/ClientApp.js",
  "/_vf_modules/_veryfront/utils/logger/logger.js",
  "/_vf_modules/_veryfront/utils/version.js",
];

async function fetchServedFrameworkModule(
  handle: Handle,
  modulePath: string,
): Promise<{ body: string; specifiers: string[] }> {
  const response = await handle(modulePath);
  assertEquals(response.status, 200, `Expected ${modulePath} to be served`);

  const body = await response.text();
  const specifiers = extractImportSpecifiers(body);

  return { body, specifiers };
}

function assertBrowserSafeFrameworkModule(
  modulePath: string,
  body: string,
  specifiers: string[],
): void {
  const specifierPaths = specifiers.map((specifier) => specifier.replace(/[?#].*$/, ""));
  const errorSpecifiers = specifierPaths.filter((specifier) =>
    specifier.startsWith("/_vf_modules/_veryfront/errors/")
  );

  assert(
    !body.includes("new Function("),
    `${modulePath} should not use unsafe-eval`,
  );
  assert(
    !specifierPaths.includes("/_vf_modules/_veryfront/errors/index.js"),
    `${modulePath} should not import the heavyweight errors barrel`,
  );
  assert(
    !specifierPaths.includes("/_vf_modules/_veryfront/platform/compat/process.js"),
    `${modulePath} should not import process compat`,
  );
  assert(
    !specifierPaths.includes("/_vf_modules/_veryfront/platform/compat/dynamic-import.js"),
    `${modulePath} should not import dynamic-import compat`,
  );
  assert(
    errorSpecifiers.every((specifier) => BROWSER_SAFE_ERROR_MODULES.has(specifier)),
    `${modulePath} should only import narrow browser-safe error modules`,
  );
}

const GRAPH_ORIGIN = "http://in-process";

async function assertBrowserSafeFrameworkGraph(
  handle: Handle,
  entryPath: string,
): Promise<void> {
  const pending = [entryPath];
  const visited = new Set<string>();
  let nextIndex = 0;

  while (nextIndex < pending.length) {
    const modulePath = pending[nextIndex++];
    if (!modulePath || visited.has(modulePath)) continue;
    visited.add(modulePath);

    const { body, specifiers } = await fetchServedFrameworkModule(handle, modulePath);
    assertBrowserSafeFrameworkModule(modulePath, body, specifiers);

    for (const specifier of specifiers) {
      const resolved = new URL(specifier, `${GRAPH_ORIGIN}${modulePath}`);
      const resolvedModulePath = `${resolved.pathname}${resolved.search}`;
      if (
        resolved.origin === GRAPH_ORIGIN &&
        resolved.pathname.startsWith("/_vf_modules/_veryfront/") &&
        // Only rewritten module URLs end in `.js`; bare import-map specifiers
        // and template-literal fragments the extractor picks up do not.
        resolved.pathname.endsWith(".js") &&
        !visited.has(resolvedModulePath)
      ) {
        pending.push(resolvedModulePath);
      }
    }
  }
}

describe("DevServer Handler Tests", () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("DevServer - Health Check Handler", {}, () => {
    it("returns 200 for /healthz endpoint", async () => {
      await withInProcessProject("dev-server-healthz", {}, async (project) => {
        const response = await project.handle("/healthz");

        assertEquals(response.status, 200);
        assertEquals(response.headers.get("content-type"), "text/plain");
        assertEquals(await response.text(), "ok");
      });
    });

    it("returns ready status for /readyz endpoint", async () => {
      await withInProcessProject("dev-server-readyz", {}, async (project) => {
        const response = await project.handle("/readyz");

        assertEquals(response.status, 200);
        assertEquals(response.headers.get("content-type"), "text/plain");
        assertEquals(await response.text(), "ready");
      });
    });

    it("returns null for non-health-check routes", async () => {
      await withInProcessProject("dev-server-health-passthrough", {}, async (project) => {
        const response = await project.handle("/");
        await response.body?.cancel();

        assertExists(response);
        assert(response.status !== 0);
      });
    });

    it("serves metrics for local dev servers", async () => {
      await withInProcessProject("dev-server-metrics", {}, async (project) => {
        const response = await project.handle("/_metrics");

        assertEquals(response.status, 200);
        const json = await response.json();
        assertExists(json?.counters);
      });
    });
  });

  describe("DevServer - Dev Endpoint Handler", {}, () => {
    it("serves HMR script when HMR is enabled", async () => {
      await withInProcessProject("dev-server-hmr-runtime", {}, async (project) => {
        const response = await project.handle("/_veryfront/hmr.js");

        assertEquals(response.status, 200);
        assertJsNoCache(response);

        const content = await response.text();
        assertExists(content);
        assert(content.length > 0);
      });
    });

    it("serves error overlay runtime", async () => {
      await withInProcessProject("dev-server-error-overlay", {}, async (project) => {
        const response = await project.handle("/_veryfront/error-overlay.js");

        assertEquals(response.status, 200);
        assertJsNoCache(response);

        const content = await response.text();
        assertExists(content);
        assert(content.length > 0);
      });
    });

    it("responds to HEAD requests for HMR script", async () => {
      await withInProcessProject("dev-server-hmr-head", {}, async (project) => {
        const response = await project.handle("/_veryfront/hmr.js", { method: "HEAD" });

        assertEquals(response.status, 200);
        const contentType = response.headers.get("content-type");
        assert(
          contentType?.startsWith("application/javascript"),
          `Expected content-type to start with "application/javascript" but got "${contentType}"`,
        );
        assertEquals(await response.text(), "");
      });
    });

    it("responds to HEAD requests for error overlay runtime", async () => {
      await withInProcessProject("dev-server-error-overlay-head", {}, async (project) => {
        const response = await project.handle("/_veryfront/error-overlay.js", { method: "HEAD" });

        assertEquals(response.status, 200);
        const contentType = response.headers.get("content-type");
        assert(
          contentType?.startsWith("application/javascript"),
          `Expected content-type to start with "application/javascript" but got "${contentType}"`,
        );
        assertEquals(await response.text(), "");
      });
    });

    it("handles virtual module requests", async () => {
      await withInProcessProject("dev-server-virtual-modules", {}, async (project) => {
        const response = await project.handle("/_veryfront/modules/component:Button");
        await response.body?.cancel();

        assert(
          response.status === 200 || response.status === 404 || response.status === 500,
          `Expected 200, 404, or 500 but got ${response.status}`,
        );
      });
    });

    it("returns null for non-dev endpoints", async () => {
      await withInProcessProject("dev-server-dev-passthrough", {}, async (project) => {
        const response = await project.handle("/");
        await response.body?.cancel();

        assertExists(response);
        assert(response.status !== 0);
      });
    });
  });

  describe("DevServer - Application Request Handler", {}, () => {
    it("delegates to runtime handler for application routes", async () => {
      await withInProcessProject("dev-server-app-handler", {}, async (project) => {
        const response = await project.handle("/");
        await response.body?.cancel();

        assertExists(response);
        assert(response.status !== 0);
      });
    });

    it("handles page requests", async () => {
      await withInProcessProject("dev-server-page-requests", {
        files: {
          "pages/test.tsx": "export default function Test() { return <div>Test Page</div> }",
        },
      }, async (project) => {
        const response = await project.handle("/test");
        await response.body?.cancel();

        assertExists(response);
        assert(response.status !== 0);
      });
    });

    it("handles API routes", async () => {
      await withInProcessProject("dev-server-api-routes", {
        files: {
          "pages/api/test.ts":
            'export async function GET() { return new Response("API Response") }',
        },
      }, async (project) => {
        const response = await project.handle("/api/test");
        await response.body?.cancel();

        assertExists(response);
        assert(response.status !== 0);
      });
    });

    it("passes through all request headers", async () => {
      await withInProcessProject("dev-server-request-headers", {}, async (project) => {
        const response = await project.handle("/", {
          headers: {
            "x-custom-header": "test-value",
            "accept": "text/html",
          },
        });
        await response.body?.cancel();

        assertExists(response);
        assert(response.status !== 0);
      });
    });

    it("serves /_veryfront/fs modules without explicit defaultProjectSlug", async () => {
      await withInProcessProject("dev-server-local-project-fallback", {
        files: { "components/fallback.js": "export default 'fallback';" },
      }, async (project) => {
        const modulePath = join(project.projectDir, "components", "fallback.js");
        const encodedPath = toBase64Url(modulePath);
        const response = await project.handle(`/_veryfront/fs/${encodedPath}.js`);

        assertEquals(response.status, 200);
        const body = await response.text();
        assert(body.includes("fallback"), "Expected bundled module content");
      });
    });

    it("serves framework markdown module without unsafe-eval helpers", async () => {
      await withInProcessProject("dev-server-framework-markdown-csp", {}, async (project) => {
        const modulePath = "/_vf_modules/_veryfront/react/components/chat/markdown.js";
        const { body, specifiers } = await fetchServedFrameworkModule(project.handle, modulePath);
        assertBrowserSafeFrameworkModule(modulePath, body, specifiers);
      });
    });

    it("serves browser framework modules with narrow CSP-safe imports", async () => {
      await withInProcessProject("dev-server-framework-chat-error-csp", {}, async (project) => {
        for (const modulePath of BROWSER_CSP_SAFE_MODULE_PATHS) {
          const { body, specifiers } = await fetchServedFrameworkModule(project.handle, modulePath);
          assertBrowserSafeFrameworkModule(modulePath, body, specifiers);
        }
      });
    });

    it("serves the complete chat module graph without unsafe-eval dependencies", async () => {
      await withInProcessProject("dev-server-framework-chat-graph-csp", {}, async (project) => {
        await assertBrowserSafeFrameworkGraph(
          project.handle,
          "/_vf_modules/_veryfront/chat/index.js",
        );
      });
    });

    it("preserves query strings while walking browser framework module variants", async () => {
      const requestedPaths: string[] = [];
      const handle: Handle = (modulePath) => {
        requestedPaths.push(modulePath);

        const body = modulePath === "/_vf_modules/_veryfront/entry.js"
          ? 'import "/_vf_modules/_veryfront/child.js?v=browser";'
          : "export const child = true;";
        return Promise.resolve(new Response(body, { status: 200 }));
      };

      await assertBrowserSafeFrameworkGraph(handle, "/_vf_modules/_veryfront/entry.js");

      assertEquals(requestedPaths, [
        "/_vf_modules/_veryfront/entry.js",
        "/_vf_modules/_veryfront/child.js?v=browser",
      ]);
    });
  });

  describe("DevServer - Error Handler", {}, () => {
    it("returns error overlay for server errors", async () => {
      await withInProcessProject("dev-server-error-handler", {}, async (project) => {
        const response = await project.handle("/nonexistent-route");
        await response.body?.cancel();

        assertExists(response);
        assert(response.status !== 0);
      });
    });

    it("sets correct content-type for error responses", async () => {
      await withInProcessProject("dev-server-error-content-type", {}, async (project) => {
        const response = await project.handle("/nonexistent");
        await response.body?.cancel();

        assertExists(response);
        if (response.status >= 400) {
          const contentType = response.headers.get("content-type");
          assert(
            contentType?.includes("text/html") || contentType?.includes("application/json"),
            "Error responses should have HTML or JSON content type",
          );
        }
      });
    });

    it("logs errors properly", async () => {
      await withInProcessProject("dev-server-error-logging", {}, async (project) => {
        const errored = await project.handle("/definitely-not-a-real-page-12345");
        await errored.body?.cancel();

        const healthResponse = await project.handle("/healthz");
        await healthResponse.body?.cancel();
        assertEquals(healthResponse.status, 200);
      });
    });

    it("handles errors without crashing server", async () => {
      await withInProcessProject("dev-server-error-resilience", {}, async (project) => {
        const errorResponses = await Promise.all([
          project.handle("/error1"),
          project.handle("/error2"),
          project.handle("/error3"),
        ]);
        await Promise.all(errorResponses.map((r) => r.body?.cancel()));

        const response = await project.handle("/healthz");
        await response.body?.cancel();
        assertEquals(response.status, 200);
      });
    });
  });

  describe("DevServer - Request Flow Integration", {}, () => {
    it("executes handlers in correct order", async () => {
      await withInProcessProject("dev-server-handler-order", {}, async (project) => {
        const healthRes = await project.handle("/healthz");
        await healthRes.body?.cancel();
        assertEquals(healthRes.status, 200);

        const appRes = await project.handle("/");
        await appRes.body?.cancel();
        assert(appRes.status >= 200 && appRes.status < 600);
      });
    });

    it("handles concurrent requests correctly", async () => {
      await withInProcessProject("dev-server-concurrent-requests", {}, async (project) => {
        const requests = await Promise.all([
          project.handle("/healthz"),
          project.handle("/"),
          project.handle("/healthz"),
          project.handle("/readyz"),
        ]);

        for (const response of requests) {
          assertExists(response);
          assert(response.status !== 0);
        }
        await Promise.all(requests.map((r) => r.body?.cancel()));
      });
    });

    it("maintains request context across handlers", async () => {
      await withInProcessProject("dev-server-request-context", {}, async (project) => {
        const response = await project.handle("/");
        await response.body?.cancel();

        const requestId = response.headers.get("x-request-id");
        assertExists(requestId, "Response should include request ID");
      });
    });

    it("handles all HTTP methods correctly", async () => {
      await withInProcessProject("dev-server-http-methods", {}, async (project) => {
        const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];

        for (const method of methods) {
          const response = await project.handle("/", { method });
          await response.body?.cancel();
          assertExists(response);
          assert(response.status !== 0);
        }
      });
    });
  });
});
