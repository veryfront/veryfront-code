import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
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
    fs: {} as RuntimeAdapter["fs"],
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
  afterEach(() => {
    injectIsolationDepsForTests(null);
    HMRHandler.shutdown();
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

  it("returns 502 when proxy context headers are present but untrusted", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request("http://localhost/page", {
        headers: {
          "x-project-slug": "my-project",
          "x-token": "spoofed-token",
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

  it("skips the proxy header guard for websocket requests", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request(
        "http://localhost/_ws?x-environment=preview&x-project-slug=test-project",
      ),
    );

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.status, "ok");
    assertExists(body.metrics);
  });

  it("skips the proxy header guard for lightweight module requests", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(new Request("http://localhost/_vf_modules/_dnt.shims.js"));

    assertEquals(response.status === 502, false);
    const body = await response.text();
    assertEquals(body.includes("x-project-slug header is required in proxy mode"), false);
    assertEquals(body.includes("x-token header is required in proxy mode"), false);
  });
});
