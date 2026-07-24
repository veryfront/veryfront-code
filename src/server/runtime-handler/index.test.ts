import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { clearConfigCache } from "#veryfront/config";
import { HMRHandler } from "../handlers/preview/hmr.handler.ts";
import { createVeryfrontHandler } from "./index.ts";
import { __injectDepsForTests as injectIsolationDepsForTests } from "./isolation.ts";
import { defaultDiscoveryCache } from "./local-project-discovery.ts";

function createMockAdapter(): RuntimeAdapter {
  return {
    id: "test",
    name: "test",
    capabilities: {},
    fs: {
      exists: () => Promise.resolve(false),
    } as unknown as RuntimeAdapter["fs"],
    env: {
      get: (_key: string) => undefined,
      set: () => {},
      delete: () => {},
      has: () => false,
      toObject: () => ({}),
    },
    server: {} as RuntimeAdapter["server"],
    serve: () => Promise.resolve({ close: () => Promise.resolve() }),
  } as unknown as RuntimeAdapter;
}

function createProxyModeHandler() {
  injectIsolationDepsForTests({
    checkRequest: () => ({ allowed: true }),
    startRequest: () => {},
    completeRequest: () => {},
  });

  return createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
    projectDir: "/tmp/test-project",
    config: {
      fs: { veryfront: { proxyMode: true } },
    } as any,
  });
}

function createProxySecurityAdapter(
  configSource: string,
  localProjectPath?: string,
): RuntimeAdapter {
  const fs = {
    getUnderlyingAdapter: () => fs,
    getAdapterType: () => "MultiProjectFSAdapter",
    isVeryfrontAdapter: () => true,
    isMultiProjectMode: () => true,
    isContextualMode: () => true,
    setRequestToken: () => {},
    clearRequestToken: () => {},
    setRequestBranch: () => {},
    getRequestBranch: () => null,
    clearRequestBranch: () => {},
    setProductionMode: () => {},
    runWithContext: <T>(
      _projectSlug: string,
      _token: string,
      fn: () => Promise<T>,
    ): Promise<T> => fn(),
    exists: (path: string) =>
      Promise.resolve(
        path === "/veryfront.config.ts" ||
          (localProjectPath !== undefined &&
            (path === localProjectPath || path === `${localProjectPath}/app`)),
      ),
    readFile: (path: string) => {
      if (path === "/veryfront.config.ts") return Promise.resolve(configSource);
      return Promise.reject(new Deno.errors.NotFound(`Not found: ${path}`));
    },
    readFileBytes: (path: string) => {
      if (path === "/veryfront.config.ts") {
        return Promise.resolve(new TextEncoder().encode(configSource));
      }
      return Promise.reject(new Deno.errors.NotFound(`Not found: ${path}`));
    },
    readOptionalTextFile: (path: string) => {
      if (path === "/veryfront.config.ts") return Promise.resolve(configSource);
      return Promise.reject(new Deno.errors.NotFound(`Not found: ${path}`));
    },
    stat: (path: string) => {
      if (
        localProjectPath !== undefined &&
        (path === localProjectPath || path === `${localProjectPath}/app`)
      ) {
        return Promise.resolve({
          size: 0,
          isFile: false,
          isDirectory: true,
          isSymlink: false,
          mtime: null,
        });
      }
      if (path === "/veryfront.config.ts") {
        return Promise.resolve({
          size: configSource.length,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: null,
        });
      }
      return Promise.reject(new Deno.errors.NotFound(`Not found: ${path}`));
    },
    readDir: async function* () {},
    readdir: () => Promise.resolve([]),
  };

  return {
    ...createMockAdapter(),
    fs,
  } as unknown as RuntimeAdapter;
}

function createProxySecurityHandler(configSource: string) {
  injectIsolationDepsForTests({
    checkRequest: () => ({ allowed: true }),
    startRequest: () => {},
    completeRequest: () => {},
  });

  return createVeryfrontHandler(
    "/tmp/test-project",
    createProxySecurityAdapter(configSource),
    {
      projectDir: "/tmp/test-project",
      config: {
        fs: { veryfront: { proxyMode: true } },
      } as any,
    },
  );
}

describe("server/runtime-handler/index", () => {
  afterEach(async () => {
    injectIsolationDepsForTests(null);
    clearConfigCache();
    defaultDiscoveryCache.clear();
    await HMRHandler.shutdown();
  });

  it("returns 502 when x-project-slug is missing in proxy mode", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request("http://localhost/page", {
        headers: { "x-token": "proxy-token" },
      }),
    );

    assertEquals(response.status, 502);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(await response.json(), {
      error: "Missing project context",
      detail: "x-project-slug header is required in proxy mode",
    });
  });

  it("returns 502 when x-token is missing in proxy mode", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request("http://localhost/page", {
        headers: { "x-project-slug": "my-project" },
      }),
    );

    assertEquals(response.status, 502);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(await response.json(), {
      error: "Missing authentication context",
      detail: "x-token header is required in proxy mode",
    });
  });

  it("allows standard first-party proxy context headers without an extra trust proof", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request("http://localhost/page", {
        headers: {
          "x-project-slug": "my-project",
          "x-token": "proxy-token",
          "x-forwarded-host": "my-project.production.veryfront.com",
          "x-release-id": "rel_123",
        },
      }),
    );

    assertEquals(response.status === 502, false);
    const body = await response.text();
    assertEquals(body.includes("proxy context headers require a trusted upstream proxy"), false);
  });

  it("returns 502 when trust-sensitive proxy context headers are present but untrusted", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request("http://localhost/page", {
        headers: {
          "x-project-slug": "my-project",
          "x-token": "spoofed-token",
          "x-project-path": "/attacker/chosen/path",
        },
      }),
    );

    assertEquals(response.status, 502);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(await response.json(), {
      error: "Untrusted proxy context",
      detail: "proxy context headers require a trusted upstream proxy",
    });
  });

  it("skips the proxy header guard for server-resolved preview websocket requests", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request("http://test-project.preview.veryfront.com/_ws"),
    );

    assertEquals(response.status, 426);
    assertEquals(await response.text(), "WebSocket upgrade required");
  });

  it("skips the proxy header guard for lightweight module requests", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request("http://localhost/_veryfront/hydration-runtime.js", {
        headers: { "x-release-id": "rel_123" },
      }),
    );

    assertEquals(response.status === 502, false);
    const body = await response.text();
    assertEquals(body.includes("x-project-slug header is required in proxy mode"), false);
    assertEquals(body.includes("x-token header is required in proxy mode"), false);
  });

  it("uses one request-scoped project security policy for proxy preflight and handlers", async () => {
    const handler = createProxySecurityHandler(`
      export default {
        security: {
          auth: {
            basic: {
              username: "alice",
              password: "secret",
              realm: "Project Area"
            }
          },
          cors: {
            origin: ["https://client.example"],
            credentials: true,
            methods: ["GET", "POST"],
            allowedHeaders: ["authorization", "x-csrf-token"]
          },
          csp: {
            "default-src": ["'none'"]
          }
        }
      };
    `);
    const proxyHeaders = {
      "x-project-slug": "secure-project",
      "x-project-id": "project_123",
      "x-token": "proxy-token",
      "x-release-id": "release_123",
      origin: "https://client.example",
    };

    const preflight = await handler(
      new Request("http://secure-project.production.veryfront.com/missing.css", {
        method: "OPTIONS",
        headers: {
          ...proxyHeaders,
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      }),
    );

    assertEquals(preflight.status, 204);
    assertEquals(
      preflight.headers.get("Access-Control-Allow-Origin"),
      "https://client.example",
    );
    assertEquals(preflight.headers.get("Access-Control-Allow-Credentials"), "true");

    const unauthorized = await handler(
      new Request("http://secure-project.production.veryfront.com/missing.css", {
        headers: proxyHeaders,
      }),
    );

    assertEquals(unauthorized.status, 401);
    assertEquals(unauthorized.headers.get("WWW-Authenticate"), 'Basic realm="Project Area"');
    assertEquals(
      unauthorized.headers.get("Access-Control-Allow-Origin"),
      "https://client.example",
    );
    assertEquals(unauthorized.headers.get("Access-Control-Allow-Credentials"), "true");

    const authorization = `Basic ${btoa("alice:secret")}`;
    const actual = await handler(
      new Request("http://secure-project.production.veryfront.com/missing.css", {
        headers: { ...proxyHeaders, authorization },
      }),
    );

    assertEquals(actual.status, 404);
    assertEquals(
      actual.headers.get("Access-Control-Allow-Origin"),
      "https://client.example",
    );
    assertEquals(actual.headers.get("Access-Control-Allow-Credentials"), "true");
    assertEquals(actual.headers.get("Content-Security-Policy"), "default-src 'none'");

    const csrfRejected = await handler(
      new Request("http://secure-project.production.veryfront.com/missing.css", {
        method: "POST",
        headers: { ...proxyHeaders, authorization },
      }),
    );

    assertEquals(csrfRejected.status, 403);
    assertEquals(
      csrfRejected.headers.get("Access-Control-Allow-Origin"),
      "https://client.example",
    );
    assertEquals(csrfRejected.headers.get("Access-Control-Allow-Credentials"), "true");
    assertEquals(await csrfRejected.text(), "Forbidden – invalid or missing CSRF token");
  });

  it("applies the hosted CSRF default to remote preview projects", async () => {
    const handler = createProxySecurityHandler(`
      export default {
        security: {
          cors: false
        }
      };
    `);

    const response = await handler(
      new Request("http://secure-project.preview.veryfront.com/missing.css", {
        method: "POST",
        headers: {
          "x-project-slug": "secure-project",
          "x-project-id": "project_123",
          "x-token": "proxy-token",
        },
      }),
    );

    assertEquals(response.status, 403);
    assertEquals(await response.text(), "Forbidden – invalid or missing CSRF token");
  });

  it("keeps development CSRF defaults for an actually local proxy project", async () => {
    const projectDir = "/local/security-project";
    const projectSlug = "local-security-project";
    const configSource = `
      export default {
        security: {
          cors: false
        }
      };
    `;
    const adapter = createProxySecurityAdapter(configSource, projectDir);
    defaultDiscoveryCache.projects.set(projectSlug, projectDir);
    defaultDiscoveryCache.adapters.set(projectDir, adapter);

    const previousTrustSetting = Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS");
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");

    try {
      const handler = createVeryfrontHandler("/tmp/test-project", adapter, {
        projectDir: "/tmp/test-project",
        config: {
          fs: { veryfront: { proxyMode: true } },
        } as any,
      });
      const response = await handler(
        new Request(`http://${projectSlug}.production.veryfront.com/missing.css`, {
          method: "POST",
          headers: {
            "x-project-slug": projectSlug,
            "x-project-id": "project_local",
            "x-project-path": projectDir,
            "x-release-id": "release_local",
            "x-token": "proxy-token",
          },
        }),
      );

      assertEquals(response.status, 404);
    } finally {
      if (previousTrustSetting === undefined) {
        Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
      } else {
        Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", previousTrustSetting);
      }
    }
  });

  it("does not invent a CSRF policy when exact-source control-plane config is deferred", async () => {
    const handler = createProxyModeHandler();
    const response = await handler(
      new Request(
        "http://localhost/api/control-plane/runs/run_123/resume",
        {
          method: "POST",
          headers: {
            "x-project-slug": "secure-project",
            "x-project-id": "project_123",
            "x-token": "proxy-token",
            "content-type": "application/json",
          },
          body: "{}",
        },
      ),
    );

    assertEquals(response.status, 500);
    assertEquals(await response.json(), {
      error: "Control-plane verification is not configured",
    });
  });
});
