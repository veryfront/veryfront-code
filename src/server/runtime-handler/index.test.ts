import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { HMRHandler } from "../handlers/preview/hmr.handler.ts";
import { createVeryfrontHandler } from "./index.ts";
import { __injectDepsForTests as injectIsolationDepsForTests } from "./isolation.ts";
import { requestTracker } from "./request-tracker.ts";

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

function captureConsoleOutput(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const capture = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.log = capture;
  console.warn = capture;
  return {
    lines,
    restore: () => {
      console.log = originalLog;
      console.warn = originalWarn;
    },
  };
}

describe("server/runtime-handler/index", () => {
  afterEach(() => {
    injectIsolationDepsForTests(null);
    HMRHandler.shutdown();
    requestTracker.shutdown();
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

  it("does not emit security guidance for the safe development defaults", async () => {
    const projectDir = await Deno.makeTempDir();
    const adapter = new DenoAdapter();
    const { lines, restore } = captureConsoleOutput();
    const originalVeryfrontEnv = Deno.env.get("VERYFRONT_ENV");
    Deno.env.set("VERYFRONT_ENV", "development");

    try {
      const handler = createVeryfrontHandler(projectDir, adapter, {
        projectDir,
        config: {} as any,
      });
      await handler.ready;
      await handler(new Request("http://localhost/healthz"));
    } finally {
      restore();
      if (originalVeryfrontEnv === undefined) Deno.env.delete("VERYFRONT_ENV");
      else Deno.env.set("VERYFRONT_ENV", originalVeryfrontEnv);
      HMRHandler.shutdown();
      await Deno.remove(projectDir, { recursive: true });
    }

    const securityGuidance = lines.filter((line) =>
      line.includes("CSRF protection is not configured") ||
      line.includes("Neither CORS nor CSRF protection is configured")
    );
    assertEquals(securityGuidance.length, 0);
  });

  it("keeps explicit security warnings visible for standalone production", async () => {
    const projectDir = await Deno.makeTempDir();
    const adapter = new DenoAdapter();
    const { lines, restore } = captureConsoleOutput();
    const originalVeryfrontEnv = Deno.env.get("VERYFRONT_ENV");
    Deno.env.set("VERYFRONT_ENV", "development");

    try {
      const handler = createVeryfrontHandler(projectDir, adapter, {
        projectDir,
        config: {
          security: { csrf: false },
        } as any,
        defaultEnvironment: "production",
      });
      await handler.ready;
      await handler(new Request("http://localhost/healthz"));
    } finally {
      restore();
      if (originalVeryfrontEnv === undefined) Deno.env.delete("VERYFRONT_ENV");
      else Deno.env.set("VERYFRONT_ENV", originalVeryfrontEnv);
      HMRHandler.shutdown();
      await Deno.remove(projectDir, { recursive: true });
    }

    assertEquals(
      lines.some((line) => line.includes("Neither CORS nor CSRF protection is configured")),
      true,
    );
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

  it("keeps the native HMR upgrade request connected", async () => {
    const adapter = new DenoAdapter();
    const projectDir = Deno.cwd();
    const handler = createVeryfrontHandler(projectDir, adapter, {
      projectDir,
      config: {} as any,
      defaultProjectSlug: "test-project",
      defaultEnvironment: "preview",
      localProjects: { "test-project": projectDir },
    });
    await handler.ready;

    let port = 0;
    const server = await adapter.serve(handler, {
      hostname: "127.0.0.1",
      port: 0,
      onListen: (address) => {
        port = address.port;
      },
    });
    assertEquals(port > 0, true);
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/_ws?x-environment=preview&x-project-slug=test-project`,
    );

    try {
      const message = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timed out waiting for the HMR connected message")),
          2_000,
        );

        socket.addEventListener("message", (event) => {
          clearTimeout(timeout);
          resolve(String(event.data));
        }, { once: true });
        socket.addEventListener("close", (event) => {
          clearTimeout(timeout);
          reject(
            new Error(
              `HMR socket closed before the connected message (code=${event.code}, clean=${event.wasClean})`,
            ),
          );
        }, { once: true });
        socket.addEventListener("error", () => {
          clearTimeout(timeout);
          reject(new Error("HMR socket failed before the connected message"));
        }, { once: true });
      });

      assertEquals(JSON.parse(message), { type: "connected" });
    } finally {
      socket.close();
      HMRHandler.shutdown();
      await server.stop();
    }
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
