import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter, RuntimeId } from "#veryfront/platform/adapters/base.ts";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { HMRHandler } from "../handlers/preview/hmr.handler.ts";
import { runWithProjectEnv } from "../project-env/storage.ts";
import { createVeryfrontHandler } from "./index.ts";
import { __injectDepsForTests as injectIsolationDepsForTests } from "./isolation.ts";
import { requestTracker } from "./request-tracker.ts";

function createMockAdapter(
  envValues: Record<string, string> = {},
  id: RuntimeId = "memory",
): RuntimeAdapter {
  return {
    id,
    name: "test",
    capabilities: {},
    fs: {
      exists: () => Promise.resolve(false),
    } as unknown as RuntimeAdapter["fs"],
    env: {
      get: (key: string) => envValues[key],
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

function captureDebugLogs(): { entries: LogEntry[]; restore: () => void } {
  const entries: LogEntry[] = [];
  const originalLogLevel = Deno.env.get("LOG_LEVEL");
  const originalDebug = Deno.env.get("VERYFRONT_DEBUG");
  Deno.env.set("LOG_LEVEL", "DEBUG");
  Deno.env.delete("VERYFRONT_DEBUG");
  __resetLoggerConfigForTests();
  __registerLogRecordEmitter((entry) => entries.push(entry));

  return {
    entries,
    restore: () => {
      if (originalLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
      else Deno.env.set("LOG_LEVEL", originalLogLevel);
      if (originalDebug === undefined) Deno.env.delete("VERYFRONT_DEBUG");
      else Deno.env.set("VERYFRONT_DEBUG", originalDebug);
      __resetLoggerConfigForTests();
      __resetLogRecordEmitterForTests();
    },
  };
}

function createDebugTestHandler(
  adapter: RuntimeAdapter,
  projectDir = "/tmp/test-project",
) {
  return createVeryfrontHandler(projectDir, adapter, {
    projectDir,
    config: {
      fs: { veryfront: { proxyMode: true } },
    } as any,
  });
}

describe("server/runtime-handler/index", () => {
  afterEach(() => {
    injectIsolationDepsForTests(null);
    HMRHandler.shutdown();
    requestTracker.shutdown();
    Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
  });

  it("preserves debug flags supplied by binding-backed runtime adapters", () => {
    const { entries, restore } = captureDebugLogs();

    try {
      for (const id of ["cloudflare", "memory"] as const) {
        entries.length = 0;
        createDebugTestHandler(
          createMockAdapter({ VERYFRONT_DEBUG: "yes" }, id),
          `/tmp/test-project-${id}`,
        );

        assertEquals(
          entries.some((entry) => entry.message === "[runtime-handler] handler initialized"),
          true,
        );
      }
    } finally {
      restore();
    }
  });

  it("reads host debug state per request despite a project env overlay", async () => {
    const { entries, restore } = captureDebugLogs();

    try {
      const handler = createDebugTestHandler(new DenoAdapter());
      entries.length = 0;

      Deno.env.set("VERYFRONT_DEBUG", "yes");
      await runWithProjectEnv(
        { VERYFRONT_DEBUG: "0" },
        () => handler(new Request("http://localhost/healthz")),
      );
      assertEquals(
        entries.some((entry) => entry.message === "Processing GET /healthz"),
        true,
      );

      Deno.env.delete("VERYFRONT_DEBUG");
      entries.length = 0;
      await runWithProjectEnv(
        { VERYFRONT_DEBUG: "yes" },
        () => handler(new Request("http://localhost/healthz")),
      );
      assertEquals(
        entries.some((entry) => entry.message === "Processing GET /healthz"),
        false,
      );
    } finally {
      restore();
    }
  });

  it("returns 502 when x-project-slug is missing in proxy mode", async () => {
    const handler = createProxyModeHandler();
    const isolationCalls = { check: 0, start: 0, complete: 0 };
    injectIsolationDepsForTests({
      checkRequest: () => {
        isolationCalls.check += 1;
        return { allowed: true };
      },
      startRequest: () => {
        isolationCalls.start += 1;
      },
      completeRequest: () => {
        isolationCalls.complete += 1;
      },
    });
    const trackerBefore = requestTracker.getStats();

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
    assertEquals(isolationCalls, { check: 0, start: 0, complete: 0 });
    assertEquals(requestTracker.getStats(), trackerBefore);
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
      line.includes("security.csrf is set to false")
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
      lines.some((line) => line.includes("security.csrf is set to false")),
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

  it("allows proxy context only behind the operator-trusted topology", async () => {
    const handler = createProxyModeHandler();
    const isolationCalls = { check: 0, start: 0, complete: 0 };
    injectIsolationDepsForTests({
      checkRequest: () => {
        isolationCalls.check += 1;
        return { allowed: true };
      },
      startRequest: () => {
        isolationCalls.start += 1;
      },
      completeRequest: () => {
        isolationCalls.complete += 1;
      },
    });
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");

    try {
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
      assertEquals(
        body.includes("Untrusted proxy context"),
        false,
        "an operator-trusted topology must not be rejected by the proxy guard",
      );
      assertEquals(
        isolationCalls.check,
        1,
        "a trusted proxy request must reach the isolation-gated pipeline",
      );
      assertEquals(
        isolationCalls.start,
        1,
        "admission must start the request rather than short-circuit at the proxy guard",
      );
      // The fixture project has no loadable config, so the first failure past
      // the proxy guard is config loading. Reaching it proves admission.
      assertEquals(
        body.includes("config-parse-error"),
        true,
        "a trusted proxy request must be admitted through to project runtime resolution",
      );
    } finally {
      Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
    }
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
      detail: "proxy mode requires an operator-trusted upstream proxy",
    });
  });

  it("rejects websocket query identity before HMR", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request(
        "http://localhost/_ws?x-environment=preview&x-project-slug=test-project",
      ),
    );

    assertEquals(response.status, 502);
    assertEquals(await response.json(), {
      error: "Missing project context",
      detail: "x-project-slug header is required in proxy mode",
    });
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

  it("preserves loopback peer provenance when dispatching cloned dev-dashboard requests", async () => {
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

    try {
      const response = await fetch(`http://127.0.0.1:${port}/_dev/api/agents`, {
        headers: { host: `localhost:${port}` },
      });
      const body = await response.text();

      assertEquals(response.status, 200, body);
      assertEquals(body.includes("Dashboard access requires"), false);
    } finally {
      await server.stop();
    }
  });

  it("applies the proxy header guard to lightweight module requests", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request("http://localhost/_veryfront/hydration-runtime.js", {
        headers: { "x-release-id": "rel_123" },
      }),
    );

    assertEquals(response.status, 502);
    assertEquals(await response.json(), {
      error: "Missing project context",
      detail: "x-project-slug header is required in proxy mode",
    });
  });

  it("rejects tokenless module identity before env loading even behind a trusted edge", async () => {
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    const originalHostToken = Deno.env.get("VERYFRONT_API_TOKEN");
    Deno.env.set("VERYFRONT_API_TOKEN", "host-token-must-not-authorize-request");
    const originalFetch = globalThis.fetch;
    let apiCalls = 0;
    globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
      apiCalls += 1;
      return Promise.reject(new Error("project environment fetch must not run"));
    }) as typeof fetch;

    try {
      const handler = createProxyModeHandler();
      const response = await handler(
        new Request("http://internal.proxy/_vf_modules/components/App.js", {
          headers: {
            "x-project-slug": "attacker-project",
            "x-project-id": "attacker-project-id",
            "x-environment-id": "attacker-environment-id",
            "x-environment": "preview",
          },
        }),
      );

      assertEquals(response.status, 502);
      assertEquals(await response.json(), {
        error: "Missing authentication context",
        detail: "x-token header is required in proxy mode",
      });
      assertEquals(apiCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalHostToken === undefined) Deno.env.delete("VERYFRONT_API_TOKEN");
      else Deno.env.set("VERYFRONT_API_TOKEN", originalHostToken);
    }
  });
});
