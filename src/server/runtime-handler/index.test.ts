// Deno-only end-to-end runtime-handler coverage. Node and Bun planners
// intentionally exclude this file because it exercises Deno.env and the Deno adapter.
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter, RuntimeId } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE } from "#veryfront/errors";
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
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createMockOidcProvider } from "#veryfront/security/application-auth/mock-oidc-provider.ts";
import { createSessionCookie } from "#veryfront/security/application-auth/cookies.ts";
import type { MiddlewareFunction } from "#veryfront/server/dev-server/middleware.ts";
import {
  createSnapshot,
  resetMetrics,
} from "#veryfront/observability/simple-metrics/metrics-state.ts";
import { resetOtelInstruments } from "#veryfront/observability/simple-metrics/otel-instruments.ts";
import {
  _resetShimForTests,
  type Meter,
  setGlobalMetricsAPI,
} from "#veryfront/observability/tracing/api-shim.ts";
import {
  getCurrentRequestContext,
  runWithRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";

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
      sourceSnapshotFreshnessOptionsVersion: 1,
      ensureSourceSnapshotFresh: () => Promise.resolve(),
      getSourceSnapshotIdentity: () => "branch:test-project:main",
      getSourceSnapshotVersion: () => 1,
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

function requireHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (value === null) throw new Error(`Missing ${name} header`);
  return value;
}

function cookiePair(response: Response): string {
  return requireHeader(response, "set-cookie").split(";")[0] ?? "";
}

function createHostedOidcAdapter(): RuntimeAdapter {
  const base = new DenoAdapter();
  const fs = Object.create(base.fs) as RuntimeAdapter["fs"];
  fs.readFile = (path: string) => {
    if (path.endsWith("/veryfront.config.ts")) {
      return Promise.resolve(`
        export default {
          security: {
            auth: {
              oidc: {
                issuerEnvVar: "OIDC_ISSUER",
                clientIdEnvVar: "OIDC_CLIENT_ID",
                clientSecretEnvVar: "OIDC_CLIENT_SECRET",
                sessionSecretEnvVar: "OIDC_SESSION_SECRET",
                scopes: ["openid", "profile", "email", "groups"],
              },
            },
          },
        };
      `);
    }
    return Promise.reject(new Deno.errors.NotFound("Hosted test file is absent"));
  };
  return { ...base, fs };
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

function withTrustedPeer(request: Request): Request {
  recordRequestPeerFromTransport(request, {
    runtime: "node",
    transport: "tcp",
    hostname: "127.0.0.1",
  });
  return request;
}

function captureOtelHttpRequestCount(): { count: () => number } {
  let count = 0;
  const meter = {
    createCounter(name) {
      return {
        add(value) {
          if (name === "veryfront.http.requests") count += value;
        },
      };
    },
    createHistogram() {
      return { record() {} };
    },
    createObservableGauge() {
      return { addCallback() {} };
    },
    createUpDownCounter() {
      return { add() {} };
    },
  } satisfies Meter;
  setGlobalMetricsAPI({ getMeter: () => meter });
  return { count: () => count };
}

describe("server/runtime-handler/index", () => {
  beforeEach(() => {
    resetMetrics();
    resetOtelInstruments();
    _resetShimForTests();
  });

  afterEach(() => {
    injectIsolationDepsForTests(null);
    HMRHandler.shutdown();
    requestTracker.shutdown();
    Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
    resetMetrics();
    resetOtelInstruments();
    _resetShimForTests();
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

  it("runs application auth admission before project middleware and registry", async () => {
    let middlewareCalls = 0;
    const handler = createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
      projectDir: "/tmp/test-project",
      config: {
        security: {
          auth: {
            trustedProxy: {
              trustedPeers: ["127.0.0.1"],
              headers: {
                subject: "x-auth-subject",
                email: "x-auth-email",
              },
            },
          },
        },
        middleware: {
          custom: [
            (c: { identity: unknown; req: Request }) => {
              middlewareCalls++;
              return Response.json({
                identity: c.identity,
                subjectHeader: c.req.headers.get("x-auth-subject"),
                emailHeader: c.req.headers.get("x-auth-email"),
              });
            },
          ],
        },
      } as any,
      allowHostProjectCodeExecution: true,
    });

    const response = await handler(withTrustedPeer(
      new Request("http://localhost/dashboard", {
        headers: {
          "x-auth-subject": "user-123",
          "x-auth-email": "user@example.test",
        },
      }),
    ));

    assertEquals(middlewareCalls, 1);
    assertEquals(await response.json(), {
      identity: {
        issuer: "veryfront:trusted-proxy",
        subject: "user-123",
        email: "user@example.test",
        groups: [],
        roles: [],
        groupsComplete: true,
        claims: {
          sub: "user-123",
          email: "user@example.test",
        },
      },
      subjectHeader: null,
      emailHeader: null,
    });
  });

  it("runs application auth admission before project middleware for plain OPTIONS", async () => {
    let middlewareCalls = 0;
    const handler = createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
      projectDir: "/tmp/test-project",
      config: {
        security: {
          auth: {
            trustedProxy: {
              trustedPeers: ["127.0.0.1"],
              headers: { subject: "x-auth-subject" },
            },
          },
        },
        middleware: {
          custom: [
            (c: { identity: { subject?: string } | null }) => {
              middlewareCalls++;
              return Response.json({ subject: c.identity?.subject ?? null });
            },
          ],
        },
      } as any,
      allowHostProjectCodeExecution: true,
    });

    const response = await handler(withTrustedPeer(
      new Request("http://localhost/api/options", {
        method: "OPTIONS",
        headers: { "x-auth-subject": "user-123" },
      }),
    ));

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { subject: "user-123" });
    assertEquals(middlewareCalls, 1);
  });

  it("short-circuits terminal application auth responses before project middleware", async () => {
    let middlewareCalls = 0;
    const handler = createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
      projectDir: "/tmp/test-project",
      config: {
        security: {
          auth: {
            trustedProxy: {
              trustedPeers: ["127.0.0.1"],
              headers: { subject: "x-auth-subject" },
            },
          },
        },
        middleware: {
          custom: [
            () => {
              middlewareCalls++;
              return new Response("project middleware ran", { status: 418 });
            },
          ],
        },
      } as any,
      allowHostProjectCodeExecution: true,
    });

    const response = await handler(
      new Request("http://localhost/dashboard", {
        headers: { "x-auth-subject": "forged-user" },
      }),
    );

    assertEquals(response.status, 401);
    assertEquals(await response.text(), "Unauthorized");
    assertEquals(middlewareCalls, 0);
  });

  it("applies the configured CORS policy to terminal application auth responses", async () => {
    const allowedOrigin = "https://client.example";
    const handler = createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
      projectDir: "/tmp/test-project",
      config: {
        security: {
          cors: { origin: [allowedOrigin], credentials: true },
          auth: {
            trustedProxy: {
              trustedPeers: ["127.0.0.1"],
              headers: { subject: "x-auth-subject" },
            },
          },
        },
      } as any,
      allowHostProjectCodeExecution: true,
    });

    const allowed = await handler(
      new Request("http://localhost/api/private", {
        headers: { origin: allowedOrigin },
      }),
    );
    assertEquals(allowed.status, 401);
    assertEquals(allowed.headers.get("Access-Control-Allow-Origin"), allowedOrigin);
    assertEquals(allowed.headers.get("Access-Control-Allow-Credentials"), "true");
    assertEquals(allowed.headers.get("Vary"), "Origin");

    const denied = await handler(
      new Request("http://localhost/api/private", {
        headers: { origin: "https://untrusted.example" },
      }),
    );
    assertEquals(denied.status, 401);
    assertEquals(denied.headers.get("Access-Control-Allow-Origin"), null);
    assertEquals(denied.headers.get("Access-Control-Allow-Credentials"), null);
  });

  /**
   * Drive a hosted preview document request whose source generation advances
   * while the request derives its configuration.
   *
   * `advanceSource` decides how the mutable source behaves. A project that was
   * just created settles once its writes land, while one being rewritten
   * continuously never does -- and the handler owes those two cases opposite
   * answers.
   */
  async function runHostedAdmissionWithMovingSnapshot(
    advanceSource: (currentVersion: number) => number,
    method: "GET" | "HEAD" = "GET",
  ): Promise<{ response: Response; sourceVersion: number; otelRequestCount: number }> {
    const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
    const originalTrustedProxy = Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS");
    Deno.env.set("VERYFRONT_API_BASE_URL", "https://api.example.test/api");
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    const otelRequests = captureOtelHttpRequestCount();
    let sourceVersion = 1;
    const baseAdapter = createHostedOidcAdapter();
    Object.assign(baseAdapter.fs, {
      getUnderlyingAdapter: () => baseAdapter.fs,
      getAdapterType: () => "MultiProjectFSAdapter",
      isVeryfrontAdapter: () => true,
      isMultiProjectMode: () => true,
      isContextualMode: () => true,
      runWithContext: <T>(
        projectSlug: string,
        token: string,
        operation: () => Promise<T>,
        projectId?: string,
        options?: { branch?: string | null },
      ) => runWithRequestContext({ projectSlug, token, projectId, ...options }, operation),
      sourceSnapshotFreshnessOptionsVersion: 1,
      ensureSourceSnapshotFresh: () => Promise.resolve(),
      getSourceSnapshotIdentity: () => {
        if (!getCurrentRequestContext()) throw new Error("missing tenant source context");
        return "branch:snapshot-project:main";
      },
      getSourceSnapshotVersion: () => {
        if (!getCurrentRequestContext()) throw new Error("missing tenant source context");
        return sourceVersion;
      },
    });
    const adapter = {
      ...baseAdapter,
      env: {
        ...baseAdapter.env,
        get(key: string) {
          if (key === "OIDC_ISSUER") sourceVersion = advanceSource(sourceVersion);
          return baseAdapter.env.get(key);
        },
      },
    } as RuntimeAdapter;
    const handler = createVeryfrontHandler("/tmp/test-project", adapter, {
      projectDir: "/tmp/test-project",
      config: { fs: { veryfront: { proxyMode: true } } } as any,
      allowHostProjectCodeExecution: true,
    });

    try {
      const response = await withMockFetch(
        (input) => {
          const url = new URL(String(input));
          if (url.origin === "https://api.example.test") {
            return Promise.resolve(Response.json({
              data: [
                { key: "APP_URL", value: "https://snapshot-app.example.test" },
                { key: "OIDC_ISSUER", value: "https://snapshot-idp.example.test" },
                { key: "OIDC_CLIENT_ID", value: "snapshot-client" },
                { key: "OIDC_CLIENT_SECRET", value: "snapshot-client-secret" },
                { key: "OIDC_SESSION_SECRET", value: "s".repeat(32) },
              ],
            }));
          }
          return Promise.reject(new Error(`Unexpected request: ${url}`));
        },
        () =>
          handler(
            new Request("https://snapshot-app.example.test/dashboard", {
              method,
              headers: {
                "x-project-slug": "snapshot-project",
                "x-project-id": "project-snapshot",
                "x-token": "snapshot-token",
                "x-environment-id": "environment-snapshot",
                "x-environment-name": "Preview",
                "x-environment": "preview",
              },
            }),
          ),
      );
      return { response, sourceVersion, otelRequestCount: otelRequests.count() };
    } finally {
      if (originalApiBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_BASE_URL");
      else Deno.env.set("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
      if (originalTrustedProxy === undefined) {
        Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
      } else {
        Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", originalTrustedProxy);
      }
    }
  }

  it("retries hosted admission when the config snapshot changes", async () => {
    const { response, sourceVersion, otelRequestCount } =
      await runHostedAdmissionWithMovingSnapshot((current) => current === 1 ? 2 : current);

    assertEquals(response.status, 401);
    assertEquals(await response.text(), "Unauthorized");
    assertEquals(sourceVersion, 2);
    // One client request counts once, however many generations it straddles.
    assertEquals(createSnapshot().requests, 1);
    assertEquals(otelRequestCount, 1);
  });

  it("rejects terminal hosted auth when the config snapshot never settles", async () => {
    // The retry exists for a source that settles. One that advances on every
    // re-derivation is being rewritten continuously, and rendering it would
    // serve configuration from a generation the markup does not come from --
    // so the guard must still fail the request closed rather than loop.
    const { response } = await runHostedAdmissionWithMovingSnapshot((current) => current + 1);

    assertEquals(response.status, 503);
    assertEquals(
      (await response.json()).type,
      "https://veryfront.com/docs/code/guides/errors#source-snapshot-freshness-unavailable",
    );
  });

  it("retries HEAD admission without adding a response body", async () => {
    const { response, sourceVersion, otelRequestCount } =
      await runHostedAdmissionWithMovingSnapshot(
        (current) => current === 1 ? 2 : current,
        "HEAD",
      );

    assertEquals(response.status, 401);
    assertEquals(await response.text(), "");
    assertEquals(sourceVersion, 2);
    assertEquals(createSnapshot().requests, 1);
    assertEquals(otelRequestCount, 1);
  });

  it("does not replay project middleware after a downstream snapshot failure", async () => {
    const otelRequests = captureOtelHttpRequestCount();
    let middlewareCalls = 0;
    const middleware: MiddlewareFunction = async (_context, next) => {
      middlewareCalls++;
      await next();
      throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
        detail: "The source changed after project middleware dispatched the route.",
      });
    };
    const handler = createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
      projectDir: "/tmp/test-project",
      config: {
        middleware: {
          custom: [middleware],
        },
      } satisfies VeryfrontConfig,
      allowHostProjectCodeExecution: true,
    });

    const response = await handler(new Request("http://localhost/dashboard"));

    assertEquals(response.status, 503);
    assertEquals(middlewareCalls, 1);
    assertEquals(createSnapshot().requests, 1);
    assertEquals(otelRequests.count(), 1);
  });

  it("keeps CORS preflight ahead of application auth admission", async () => {
    let middlewareCalls = 0;
    const handler = createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
      projectDir: "/tmp/test-project",
      config: {
        security: {
          auth: {
            trustedProxy: {
              trustedPeers: ["127.0.0.1"],
              headers: { subject: "x-auth-subject" },
            },
          },
        },
        middleware: {
          custom: [
            () => {
              middlewareCalls++;
              return new Response("middleware must not run", { status: 401 });
            },
          ],
        },
      } as any,
      allowHostProjectCodeExecution: true,
    });

    const response = await handler(
      new Request("http://localhost/dashboard", {
        method: "OPTIONS",
        headers: {
          origin: "https://client.example",
          "access-control-request-method": "GET",
        },
      }),
    );

    assertEquals(response.status, 204);
    assertEquals(middlewareCalls, 0);
  });

  it("keeps CSP reports ahead of application auth admission", async () => {
    const handler = createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
      projectDir: "/tmp/test-project",
      config: {
        security: {
          auth: {
            trustedProxy: {
              trustedPeers: ["127.0.0.1"],
              headers: { subject: "x-auth-subject" },
            },
          },
        },
      } as any,
      allowHostProjectCodeExecution: true,
    });

    const response = await handler(
      new Request("http://localhost/_vf/csp-report", { method: "POST" }),
    );

    assertEquals(response.status, 204);
  });

  it("admits authenticated HMR endpoint requests before AuthHandler", async () => {
    const handler = createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
      projectDir: "/tmp/test-project",
      config: {
        security: {
          auth: {
            trustedProxy: {
              trustedPeers: ["127.0.0.1"],
              headers: { subject: "x-auth-subject" },
            },
          },
        },
      } as any,
      allowHostProjectCodeExecution: true,
    });

    const response = await handler(withTrustedPeer(
      new Request("http://localhost/_ws", {
        headers: { "x-auth-subject": "user-123" },
      }),
    ));

    assertEquals(response.status, 200);
    assertEquals((await response.json()).message, "HMR WebSocket endpoint - connect via WebSocket");
  });

  it("short-circuits OIDC auth route terminal responses before project middleware", async () => {
    const otelRequests = captureOtelHttpRequestCount();
    let middlewareCalls = 0;
    const handler = createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
      projectDir: "/tmp/test-project",
      config: {
        security: {
          auth: {
            oidc: {
              issuerEnvVar: "OIDC_ISSUER",
              clientIdEnvVar: "OIDC_CLIENT_ID",
              clientSecretEnvVar: "OIDC_CLIENT_SECRET",
              sessionSecretEnvVar: "OIDC_SESSION_SECRET",
              scopes: ["openid"],
            },
          },
        },
        middleware: {
          custom: [
            () => {
              middlewareCalls++;
              return new Response("project middleware ran", { status: 418 });
            },
          ],
        },
      } as any,
      allowHostProjectCodeExecution: true,
    });

    for (
      const path of [
        "/_veryfront/auth/login",
        "/_veryfront/auth/callback?state=bad&code=bad",
        "/_veryfront/auth/logout",
      ]
    ) {
      const method = path.includes("logout") ? "POST" : "GET";
      const response = await handler(new Request(`http://localhost${path}`, { method }));
      assertEquals(response.status, 500);
      assertEquals(await response.text(), "Authentication unavailable");
    }

    assertEquals(middlewareCalls, 0);
    assertEquals(createSnapshot().requests, 3);
    assertEquals(otelRequests.count(), 3);
  });

  it("counts terminal application auth and normal requests without counting monitoring fast paths", async () => {
    const otelRequests = captureOtelHttpRequestCount();
    let middlewareCalls = 0;
    const handler = createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
      projectDir: "/tmp/test-project",
      config: {
        security: {
          auth: {
            trustedProxy: {
              trustedPeers: ["127.0.0.1"],
              headers: { subject: "x-auth-subject" },
            },
          },
        },
        middleware: {
          custom: [
            () => {
              middlewareCalls++;
              return new Response("ok");
            },
          ],
        },
      } satisfies VeryfrontConfig,
      allowHostProjectCodeExecution: true,
    });

    const terminal = await handler(new Request("http://localhost/dashboard"));
    const normal = await handler(withTrustedPeer(
      new Request("http://localhost/dashboard", {
        headers: { "x-auth-subject": "user-123" },
      }),
    ));
    const monitoring = await handler(new Request("http://localhost/healthz"));

    assertEquals(terminal.status, 401);
    assertEquals(normal.status, 200);
    assertEquals(monitoring.status, 200);
    assertEquals(middlewareCalls, 1);
    assertEquals(createSnapshot().requests, 2);
    assertEquals(otelRequests.count(), 2);
  });

  it("isolates concurrent shared-runtime OIDC admission under each project environment", async () => {
    const hostEnvNames = [
      "VERYFRONT_TRUST_FORWARDED_HEADERS",
      "VERYFRONT_API_BASE_URL",
      "APP_URL",
      "OIDC_ISSUER",
      "OIDC_CLIENT_ID",
      "OIDC_CLIENT_SECRET",
      "OIDC_SESSION_SECRET",
    ] as const;
    const originalHostEnv = new Map(hostEnvNames.map((name) => [name, Deno.env.get(name)]));
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    Deno.env.set("VERYFRONT_API_BASE_URL", "https://api.example.test/api");
    Deno.env.delete("APP_URL");
    Deno.env.set("OIDC_ISSUER", "https://wrong-host.example.test");
    Deno.env.set("OIDC_CLIENT_ID", "wrong-host-client");
    Deno.env.set("OIDC_CLIENT_SECRET", "wrong-host-client-secret");
    Deno.env.set("OIDC_SESSION_SECRET", "wrong-host-session-secret-value");

    const alpha = await createMockOidcProvider({
      issuer: "https://alpha-idp.example.test",
      clientId: "alpha-client",
      clientSecret: "alpha-client-secret",
    });
    const beta = await createMockOidcProvider({
      issuer: "https://beta-idp.example.test",
      clientId: "beta-client",
      clientSecret: "beta-client-secret",
    });
    const environments = {
      alpha: {
        APP_URL: "https://alpha-app.example.test",
        OIDC_ISSUER: alpha.urls.issuer,
        OIDC_CLIENT_ID: "alpha-client",
        OIDC_CLIENT_SECRET: "alpha-client-secret",
        OIDC_SESSION_SECRET: "a".repeat(32),
      },
      beta: {
        APP_URL: "https://beta-app.example.test",
        OIDC_ISSUER: beta.urls.issuer,
        OIDC_CLIENT_ID: "beta-client",
        OIDC_CLIENT_SECRET: "beta-client-secret",
        OIDC_SESSION_SECRET: "b".repeat(32),
      },
      gamma: {
        APP_URL: "https://gamma-app.example.test",
        OIDC_ISSUER: alpha.urls.issuer,
        OIDC_CLIENT_ID: "alpha-client",
        OIDC_CLIENT_SECRET: "alpha-client-secret",
      },
    } as const;
    const handler = createVeryfrontHandler("/tmp/test-project", createHostedOidcAdapter(), {
      projectDir: "/tmp/test-project",
      config: { fs: { veryfront: { proxyMode: true } } } as any,
    });

    const login = (tenant: keyof typeof environments) =>
      handler(
        new Request(`https://${tenant}-app.example.test/_veryfront/auth/login`, {
          headers: {
            "x-project-slug": `${tenant}-project`,
            "x-project-id": `project-${tenant}`,
            "x-token": `project-token-${tenant}`,
            "x-environment-id": `environment-${tenant}`,
            "x-environment-name": "Preview",
            "x-environment": "preview",
          },
        }),
      );

    try {
      const [alphaResponse, betaResponse, missingKeyResponse] = await withMockFetch(
        (input, init) => {
          const url = new URL(String(input));
          if (url.origin === "https://api.example.test") {
            const tenant = url.pathname.includes("alpha-project")
              ? "alpha"
              : url.pathname.includes("beta-project")
              ? "beta"
              : "gamma";
            return Promise.resolve(Response.json({
              data: Object.entries(environments[tenant]).map(([key, value]) => ({ key, value })),
            }));
          }
          if (url.origin === new URL(alpha.urls.issuer).origin) return alpha.fetch(input, init);
          return beta.fetch(input, init);
        },
        async () => {
          const concurrent = await Promise.all([login("alpha"), login("beta")]);
          return [...concurrent, await login("gamma")] as const;
        },
      );

      assertEquals(alphaResponse.status, 302);
      assertEquals(betaResponse.status, 302);
      assertEquals(
        new URL(alphaResponse.headers.get("location") ?? "").origin,
        new URL(alpha.urls.authorization).origin,
      );
      assertEquals(
        new URL(betaResponse.headers.get("location") ?? "").origin,
        new URL(beta.urls.authorization).origin,
      );
      assertEquals(alpha.getCallCounts().discovery, 1);
      assertEquals(beta.getCallCounts().discovery, 1);
      assertEquals(missingKeyResponse.status, 500);
      assertEquals(
        alpha.getCallCounts().discovery,
        1,
        "a missing project key must not fall through to the host session secret",
      );
    } finally {
      for (const name of hostEnvNames) {
        const original = originalHostEnv.get(name);
        if (original === undefined) Deno.env.delete(name);
        else Deno.env.set(name, original);
      }
    }
  });

  it("completes OIDC callbacks with session_state, mixed JWKS, and large group claims", async () => {
    const provider = await createMockOidcProvider({
      issuer: "https://keycloak-idp.example.test",
      clientId: "keycloak-client",
      clientSecret: "keycloak-client-secret",
      now: Math.floor(Date.now() / 1_000),
    });
    provider.addPublishedJwksKeyForTesting({
      kty: "oct",
      kid: "encryption-key",
      use: "enc",
      k: "dW5yZWxhdGVk",
    });
    const handler = createVeryfrontHandler(
      "/tmp/test-project",
      createMockAdapter({
        APP_URL: "https://app.example.test",
        OIDC_ISSUER: provider.urls.issuer,
        OIDC_CLIENT_ID: "keycloak-client",
        OIDC_CLIENT_SECRET: "keycloak-client-secret",
        OIDC_SESSION_SECRET: "k".repeat(32),
      }),
      {
        projectDir: "/tmp/test-project",
        config: {
          security: {
            auth: {
              oidc: {
                issuerEnvVar: "OIDC_ISSUER",
                clientIdEnvVar: "OIDC_CLIENT_ID",
                clientSecretEnvVar: "OIDC_CLIENT_SECRET",
                sessionSecretEnvVar: "OIDC_SESSION_SECRET",
                scopes: ["openid", "profile", "email", "groups"],
              },
            },
          },
        } as any,
        allowHostProjectCodeExecution: true,
      },
    );

    const login = await provider.run(() =>
      handler(new Request("https://app.example.test/_veryfront/auth/login"))
    );
    const callbackUrl = provider.authorize(requireHeader(login, "location"), {
      callbackParams: { session_state: "keycloak-session-state.123" },
      claims: {
        email: "user@example.test",
        name: "Keycloak User",
        groups: Array.from(
          { length: 80 },
          (_, index) => `entra-group-${String(index).padStart(3, "0")}-00000000`,
        ),
      },
    });

    const callback = await provider.run(() =>
      handler(
        new Request(callbackUrl, {
          headers: { cookie: cookiePair(login) },
        }),
      )
    );

    assertEquals(login.status, 302);
    assertEquals(callback.status, 303);
    assertEquals(requireHeader(callback, "set-cookie").includes("__Host-vf_session="), true);
  });

  it("keeps monitoring bypass ahead of application auth admission", async () => {
    let middlewareCalls = 0;
    const handler = createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
      projectDir: "/tmp/test-project",
      config: {
        security: {
          auth: {
            trustedProxy: {
              trustedPeers: ["127.0.0.1"],
              headers: { subject: "x-auth-subject" },
            },
          },
        },
        middleware: {
          custom: [
            () => {
              middlewareCalls++;
              return new Response("project middleware ran", { status: 418 });
            },
          ],
        },
      } as any,
    });

    const response = await handler(new Request("http://localhost/healthz"));

    assertEquals(response.status, 200);
    assertEquals(middlewareCalls, 0);

    const preflight = await handler(
      new Request("http://localhost/healthz", {
        method: "OPTIONS",
        headers: {
          origin: "https://client.example",
          "access-control-request-method": "GET",
        },
      }),
    );

    assertEquals(preflight.status, 204);
    assertEquals(middlewareCalls, 0);
  });

  it("admits authenticated requests on the gated monitoring fast path", async () => {
    const handler = createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
      projectDir: "/tmp/test-project",
      config: {
        security: {
          auth: {
            trustedProxy: {
              trustedPeers: ["127.0.0.1"],
              headers: { subject: "x-auth-subject" },
            },
          },
        },
      } satisfies VeryfrontConfig,
    });
    const request = new Request("http://localhost/_health", {
      headers: { "x-auth-subject": "monitor-user" },
    });
    recordRequestPeerFromTransport(request, {
      runtime: "deno",
      transport: "tcp",
      hostname: "127.0.0.1",
    });

    const response = await handler(request);

    assertEquals(response.status, 200);
  });

  it("applies the configured CORS policy to monitoring auth failures", async () => {
    const allowedOrigin = "https://client.example";
    const handler = createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
      projectDir: "/tmp/test-project",
      config: {
        security: {
          cors: { origin: [allowedOrigin], credentials: true },
          auth: {
            trustedProxy: {
              trustedPeers: ["127.0.0.1"],
              headers: { subject: "x-auth-subject" },
            },
          },
        },
      } satisfies VeryfrontConfig,
    });
    const request = new Request("http://localhost/_health", {
      headers: { origin: allowedOrigin },
    });
    recordRequestPeerFromTransport(request, {
      runtime: "deno",
      transport: "tcp",
      hostname: "127.0.0.1",
    });

    const response = await handler(request);

    assertEquals(response.status, 401);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), allowedOrigin);
    assertEquals(response.headers.get("Access-Control-Allow-Credentials"), "true");
    assertEquals(response.headers.get("Vary"), "Origin");
  });

  it("uses the trusted forwarded origin for OIDC on the monitoring fast path", async () => {
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    const provider = await createMockOidcProvider({
      issuer: "https://monitoring-idp.example.test",
      clientId: "monitoring-client",
      clientSecret: "monitoring-client-secret",
      now: Math.floor(Date.now() / 1_000),
    });
    const clientId = "monitoring-client";
    const sessionSecret = "monitoring-session-secret-value-32";
    const handler = createVeryfrontHandler(
      "/tmp/test-project",
      createMockAdapter({
        APP_URL: "https://app.example.test",
        OIDC_ISSUER: provider.urls.issuer,
        OIDC_CLIENT_ID: clientId,
        OIDC_CLIENT_SECRET: "monitoring-client-secret",
        OIDC_SESSION_SECRET: sessionSecret,
      }),
      {
        projectDir: "/tmp/test-project",
        config: {
          security: {
            auth: {
              oidc: {
                issuerEnvVar: "OIDC_ISSUER",
                clientIdEnvVar: "OIDC_CLIENT_ID",
                clientSecretEnvVar: "OIDC_CLIENT_SECRET",
                sessionSecretEnvVar: "OIDC_SESSION_SECRET",
                scopes: ["openid"],
              },
            },
          },
        } satisfies VeryfrontConfig,
        allowHostProjectCodeExecution: true,
      },
    );
    const forwardedHeaders = {
      "x-forwarded-host": "app.example.test",
      "x-forwarded-proto": "https",
    };
    const login = await provider.run(() =>
      handler(
        new Request("http://runtime.internal/_veryfront/auth/login", {
          headers: forwardedHeaders,
        }),
      )
    );
    const publicCallback = new URL(provider.authorize(requireHeader(login, "location")));
    const callback = await provider.run(() =>
      handler(
        new Request(`http://runtime.internal${publicCallback.pathname}${publicCallback.search}`, {
          headers: {
            ...forwardedHeaders,
            cookie: cookiePair(login),
          },
        }),
      )
    );
    const applicationSession = requireHeader(callback, "set-cookie").match(
      /__Host-vf_session=[^;,]+/,
    )?.[0];

    const response = await handler(
      new Request("http://runtime.internal/_health", {
        headers: {
          ...forwardedHeaders,
          cookie: applicationSession ?? "missing-session",
        },
      }),
    );

    assertEquals(login.status, 302);
    assertEquals(callback.status, 303);
    assertEquals(response.status, 200);
  });

  it("keeps signed control-plane verification separate from application OIDC sessions", async () => {
    const issuer = "https://issuer.example.test";
    const clientId = "control-plane-separation-client";
    const sessionSecret = "control-plane-separation-session-secret";
    const envValues: Record<string, string> = {
      APP_URL: "https://app.example.test",
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: clientId,
      OIDC_CLIENT_SECRET: "control-plane-separation-client-secret",
      OIDC_SESSION_SECRET: sessionSecret,
    };
    const authEnvNames = new Set([
      "APP_URL",
      "OIDC_ISSUER",
      "OIDC_CLIENT_ID",
      "OIDC_CLIENT_SECRET",
      "OIDC_SESSION_SECRET",
    ]);
    const authEnvReads: string[] = [];
    let providerCalls = 0;
    const baseAdapter = createMockAdapter();
    const adapter = {
      ...baseAdapter,
      env: {
        ...baseAdapter.env,
        get(name: string) {
          if (authEnvNames.has(name)) authEnvReads.push(name);
          return envValues[name];
        },
      },
    } as RuntimeAdapter;
    const handler = createVeryfrontHandler("/tmp/test-project", adapter, {
      projectDir: "/tmp/test-project",
      config: {
        security: {
          auth: {
            oidc: {
              issuerEnvVar: "OIDC_ISSUER",
              clientIdEnvVar: "OIDC_CLIENT_ID",
              clientSecretEnvVar: "OIDC_CLIENT_SECRET",
              sessionSecretEnvVar: "OIDC_SESSION_SECRET",
              scopes: ["openid"],
            },
          },
        },
      } as any,
      allowHostProjectCodeExecution: true,
    });
    const now = Math.floor(Date.now() / 1_000);
    const setCookie = await createSessionCookie({
      secret: sessionSecret,
      payload: {
        v: 1,
        issuer,
        subject: "application-user",
        claims: { sub: "application-user", aud: clientId },
      },
      maxAgeSeconds: 300,
      now,
    });
    const applicationSession = setCookie.slice(0, setCookie.indexOf(";"));

    const response = await withMockFetch(
      () => {
        providerCalls += 1;
        return Promise.reject(new Error("provider traffic is forbidden for control-plane calls"));
      },
      () =>
        handler(
          new Request("https://app.example.test/api/control-plane/runs/run_1/stream", {
            method: "POST",
            headers: {
              cookie: applicationSession,
              "x-veryfront-control-plane-jws": "malformed.signature.value",
            },
          }),
        ),
    );

    assertEquals(response.status, 400);
    assertEquals(authEnvReads, []);
    assertEquals(providerCalls, 0);
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
      // Reaching isolation proves admission into the project runtime pipeline.
      // Do not assert the later config error shape here: hosted-config tests
      // install evaluator hooks in the parallel unit suite, and this test only
      // owns the proxy-admission boundary.
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
