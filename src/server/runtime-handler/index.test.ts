import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { HMRHandler } from "../handlers/preview/hmr.handler.ts";
import { createVeryfrontHandler } from "./index.ts";
import { __injectDepsForTests as injectIsolationDepsForTests } from "./isolation.ts";

function createMockAdapter(): RuntimeAdapter {
  return {
    id: "test",
    name: "test",
    capabilities: {},
    fs: {
      exists: () => Promise.resolve(false),
    } as RuntimeAdapter["fs"],
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

describe("server/runtime-handler/index", () => {
  afterEach(async () => {
    injectIsolationDepsForTests(null);
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
});
