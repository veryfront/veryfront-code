import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { deleteHostSecret, setHostSecret } from "#veryfront/platform/compat/process/env.ts";
import { refreshEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { HOST_INTERNAL_EGRESS_OVERRIDE_ENV } from "#veryfront/security/http/outbound-fetch.ts";
import { MAX_INTEGRATION_TOOL_LIST_ATTEMPTS } from "./limits.ts";
import {
  __subscribeLogRecordEmitter,
  type LogEntry,
  LogLevel,
  refreshLoggerConfig,
  setLogLevel,
} from "#veryfront/utils/logger/logger.ts";
import {
  executeRemoteIntegrationTool,
  getRemoteIntegrationToolDefinitions,
  getRemoteIntegrationToolDiscovery,
  isRemoteIntegrationTool,
  type RemoteIntegrationToolDiscoveryResult,
  runWithRemoteIntegrationToolDiscoveryScope,
} from "./remote-tools.ts";

const DISCOVERY_FAILURE_MESSAGE = "Failed to fetch remote integration tool definitions";

const ENV_KEYS = [
  "PROXY_MODE",
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_API_URL",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
] as const;

const originalEnv = new Map(ENV_KEYS.map((key) => [key, getEnv(key)]));

function restoreRemoteToolEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      deleteEnv(key);
      continue;
    }
    setEnv(key, value);
  }

  refreshEnvironmentConfig();
}

function setRemoteToolEnv(overrides: Record<string, string>): void {
  for (const key of ENV_KEYS) {
    deleteEnv(key);
  }

  for (const [key, value] of Object.entries(overrides)) {
    setEnv(key, value);
  }

  refreshEnvironmentConfig();
}

/**
 * Collect the integration tool discovery log records emitted while `run`
 * executes. Debug records only reach subscribers when the debug level is
 * active, so the level is forced for the duration of the call.
 */
async function captureIntegrationDiscoveryLogs(
  run: () => Promise<unknown>,
): Promise<LogEntry[]> {
  const records: LogEntry[] = [];
  const unsubscribe = __subscribeLogRecordEmitter((entry) => {
    if (entry.message.includes("integration tool")) records.push(entry);
  });
  setLogLevel(LogLevel.DEBUG);

  try {
    await run();
  } finally {
    unsubscribe();
    refreshLoggerConfig();
  }

  return records;
}

afterEach(() => {
  restoreRemoteToolEnv();
});

describe("integrations/remote-tools", () => {
  it("does not keep a legacy string end-user overload for remote tool execution", async () => {
    const source = await Deno.readTextFile(new URL("./remote-tools.ts", import.meta.url));

    assertEquals(source.includes("contextOrEndUserId"), false);
    assertEquals(source.includes('typeof contextOrEndUserId === "string"'), false);
  });

  it("does not keep legacy OAuth caller identity URL sanitizers in live remote tools", async () => {
    const source = await Deno.readTextFile(new URL("./remote-tools.ts", import.meta.url));
    const legacyCallerIdentityParam = ["end", "User", "Id"].join("");

    assertEquals(source.includes(legacyCallerIdentityParam), false);
  });

  it("skips remote tool discovery when API configuration is missing", async () => {
    setRemoteToolEnv({});

    const definitions = await withMockFetch(async () => {
      throw new Error("fetch should not run without remote API configuration");
    }, async () => await getRemoteIntegrationToolDefinitions());

    assertEquals(definitions, []);
  });

  it("discovers integration tools from a host-private stored login token", async () => {
    // `applyRuntimeAuthContext` keeps a stored `veryfront login` token out of
    // the process environment, so the environment snapshot carries nothing and
    // only `getHostEnv` resolves the credential. Single-project runtimes must
    // still authenticate discovery with it.
    setRemoteToolEnv({ VERYFRONT_API_BASE_URL: "https://api.test" });
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

    let authorization = "";
    try {
      const discovery = await withMockFetch(async (input, init) => {
        authorization = new Request(input, init).headers.get("Authorization") ?? "";
        return Response.json({ tools: [] });
      }, () => getRemoteIntegrationToolDiscovery());

      assertEquals(authorization, "Bearer stored-login-token");
      // A reached catalog returns "ok"; without the credential discovery would
      // short-circuit to an empty catalog before any request is made.
      assertEquals(discovery.status, "ok");
    } finally {
      deleteHostSecret("VERYFRONT_API_TOKEN");
    }
  });

  it("binds a stored login token to the host-owned API origin", async () => {
    setRemoteToolEnv({});
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

    let requestedUrl = "";
    try {
      await runWithProjectEnv(
        { VERYFRONT_API_BASE_URL: "https://project-controlled.example/api" },
        () =>
          withMockFetch(async (input) => {
            requestedUrl = String(input);
            return Response.json({ tools: [] });
          }, () => getRemoteIntegrationToolDiscovery()),
      );
    } finally {
      deleteHostSecret("VERYFRONT_API_TOKEN");
    }

    assertEquals(
      requestedUrl,
      "https://api.veryfront.com/integrations/tools/list",
    );
  });

  it("routes the stored login token through the host transport, not globalThis.fetch", async () => {
    // Locally loaded project code runs in this realm and can replace
    // `globalThis.fetch` before integration discovery or execution. The
    // integration API dispatch must not hand the host-private credential's
    // `Authorization` header to that replacement.
    setRemoteToolEnv({ VERYFRONT_API_BASE_URL: "https://api.test" });
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

    let authorization = "";
    let hostileFetchCalls = 0;
    try {
      const discovery = await withMockFetch(async (input, init) => {
        authorization = new Request(input, init).headers.get("Authorization") ?? "";
        return Response.json({ tools: [] });
      }, async () => {
        // Deliberate hostile replacement, not a test stub: the mock transport
        // installed by `withMockFetch` must still carry the request while this
        // project-style hook observes nothing.
        const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch")!;
        Object.defineProperty(globalThis, "fetch", {
          configurable: true,
          writable: true,
          value: (): Promise<Response> => {
            hostileFetchCalls += 1;
            return Promise.resolve(Response.json({ tools: [] }));
          },
        });
        try {
          return await getRemoteIntegrationToolDiscovery();
        } finally {
          Object.defineProperty(globalThis, "fetch", originalFetch);
        }
      });

      // The request still authenticates through the host transport, and the
      // replaced global never ran.
      assertEquals(discovery.status, "ok");
      assertEquals(authorization, "Bearer stored-login-token");
      assertEquals(hostileFetchCalls, 0);
    } finally {
      deleteHostSecret("VERYFRONT_API_TOKEN");
    }
  });

  it("validates the stored login token without a mutable String.prototype hook", async () => {
    // Project code served by `veryfront dev` runs in this realm and can replace
    // `String.prototype.charCodeAt` before integration discovery. Token
    // validation must never hand the host-private credential to such a hook as
    // its method receiver.
    setRemoteToolEnv({ VERYFRONT_API_BASE_URL: "https://api.test" });
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

    const originalCharCodeAt = Object.getOwnPropertyDescriptor(
      String.prototype,
      "charCodeAt",
    )!;
    let observedCredential = 0;
    Object.defineProperty(String.prototype, "charCodeAt", {
      configurable: true,
      writable: true,
      value: function (this: unknown, index: number): number {
        if (this === "stored-login-token") observedCredential += 1;
        return Reflect.apply(originalCharCodeAt.value, this, [index]);
      },
    });

    let authorization = "";
    try {
      await withMockFetch(async (input, init) => {
        authorization = new Request(input, init).headers.get("Authorization") ?? "";
        return Response.json({ tools: [] });
      }, () => getRemoteIntegrationToolDiscovery());
    } finally {
      Object.defineProperty(String.prototype, "charCodeAt", originalCharCodeAt);
      deleteHostSecret("VERYFRONT_API_TOKEN");
    }

    // The credential still authenticates discovery, and the poisoned hook never
    // received it as a receiver.
    assertEquals(authorization, "Bearer stored-login-token");
    assertEquals(observedCredential, 0);
  });

  it("does not let a blank exported token shadow the stored login token", async () => {
    // The environment snapshot keeps a whitespace-only export verbatim, and the
    // CLI treats that as "unset" when it registers the stored token.
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "   ",
    });
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

    let authorization = "";
    try {
      await withMockFetch(async (input, init) => {
        authorization = new Request(input, init).headers.get("Authorization") ?? "";
        return Response.json({ tools: [] });
      }, () => getRemoteIntegrationToolDiscovery());

      assertEquals(authorization, "Bearer stored-login-token");
    } finally {
      deleteHostSecret("VERYFRONT_API_TOKEN");
    }
  });

  it("blocks an internal API base unless the host enables internal egress", async () => {
    // Routing the credentialed integration API through `guardedOutboundFetch`
    // puts it under the host egress ceiling, which denies private and loopback
    // destinations by default. Pinning both halves here: a developer or
    // self-hosted deployment that points `VERYFRONT_API_BASE_URL` at an
    // internal host must set `VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS`, and once
    // it is set the request goes through unchanged.
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "http://127.0.0.1:8787",
      VERYFRONT_API_TOKEN: "token",
    });

    let requests = 0;
    const respond = () => {
      requests += 1;
      return Promise.resolve(Response.json({ tools: [] }));
    };

    const blocked = await withMockFetch(
      respond,
      () => getRemoteIntegrationToolDiscovery(),
    );
    assertEquals(blocked, { status: "unavailable", reason: "request_failed" });
    assertEquals(requests, 0);

    setEnv(HOST_INTERNAL_EGRESS_OVERRIDE_ENV, "1");
    try {
      const allowed = await withMockFetch(
        respond,
        () => getRemoteIntegrationToolDiscovery(),
      );
      assertEquals(allowed, { status: "ok", tools: [] });
      assertEquals(requests, 1);
    } finally {
      deleteEnv(HOST_INTERNAL_EGRESS_OVERRIDE_ENV);
    }
  });

  it("memoizes a typed empty integration catalog for the current run", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    const results = await withMockFetch(async () => {
      fetchCalls++;
      return Response.json({ tools: [] });
    }, () =>
      runWithRemoteIntegrationToolDiscoveryScope(async () => [
        await getRemoteIntegrationToolDiscovery(),
        await getRemoteIntegrationToolDiscovery(),
      ]));

    assertEquals(fetchCalls, 1);
    assertEquals(results, [
      { status: "ok", tools: [] },
      { status: "ok", tools: [] },
    ]);
  });

  it("shares one retry sequence across concurrent discovery callers", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    let results: RemoteIntegrationToolDiscoveryResult[] = [];
    const records = await captureIntegrationDiscoveryLogs(async () => {
      results = await withMockFetch(async () => {
        fetchCalls++;
        if (fetchCalls === 1) {
          throw new TypeError("error trying to connect: connection reset");
        }
        return Response.json({
          tools: [{
            name: "github__list_issues",
            description: "List issues",
            inputSchema: { type: "object", properties: {} },
          }],
        });
      }, () =>
        runWithRemoteIntegrationToolDiscoveryScope(() =>
          Promise.all([
            getRemoteIntegrationToolDiscovery(),
            getRemoteIntegrationToolDiscovery(),
          ])
        ));
    });

    assertEquals(fetchCalls, 2);
    assertEquals(results, [
      {
        status: "ok",
        tools: [{
          name: "github__list_issues",
          description: "List issues",
          parameters: { type: "object", properties: {} },
        }],
      },
      {
        status: "ok",
        tools: [{
          name: "github__list_issues",
          description: "List issues",
          parameters: { type: "object", properties: {} },
        }],
      },
    ]);
    assertEquals(records.map((entry) => entry.level), ["debug"]);
  });

  it("retries a server failure without logging an error when discovery recovers", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    let result: RemoteIntegrationToolDiscoveryResult | undefined;
    const records = await captureIntegrationDiscoveryLogs(async () => {
      result = await withMockFetch(async () => {
        fetchCalls++;
        return fetchCalls === 1
          ? new Response(undefined, { status: 503, statusText: "Service Unavailable" })
          : Response.json({ tools: [] });
      }, () => getRemoteIntegrationToolDiscovery());
    });

    assertEquals(fetchCalls, 2);
    assertEquals(result, { status: "ok", tools: [] });
    assertEquals(records.map((entry) => entry.level), ["debug"]);
  });

  it("retries a response-body transport failure and recovers discovery", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    let result: RemoteIntegrationToolDiscoveryResult | undefined;
    const records = await captureIntegrationDiscoveryLogs(async () => {
      result = await withMockFetch(async () => {
        fetchCalls++;
        if (fetchCalls === 1) {
          return new Response(
            new ReadableStream({
              pull(controller) {
                controller.error(new TypeError("connection reset while reading body"));
              },
            }),
          );
        }
        return Response.json({ tools: [] });
      }, () => getRemoteIntegrationToolDiscovery());
    });

    assertEquals(fetchCalls, 2);
    assertEquals(result, { status: "ok", tools: [] });
    assertEquals(records.map((entry) => entry.level), ["debug"]);
  });

  it("does not retry local project slug validation failures", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    let result: RemoteIntegrationToolDiscoveryResult | undefined;
    const records = await captureIntegrationDiscoveryLogs(async () => {
      result = await withMockFetch(async () => {
        fetchCalls++;
        return Response.json({ tools: [] });
      }, () =>
        getRemoteIntegrationToolDiscovery({
          authToken: "request-token",
          projectSlug: "not_a_canonical_slug",
        }));
    });

    assertEquals(fetchCalls, 0);
    assertEquals(result, { status: "unavailable", reason: "request_failed" });
    assertEquals(records.map((entry) => entry.level), ["error"]);
  });

  it("does not retry an invalid integration API base URL", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "not-a-url",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    let result: RemoteIntegrationToolDiscoveryResult | undefined;
    const records = await captureIntegrationDiscoveryLogs(async () => {
      result = await withMockFetch(async () => {
        fetchCalls++;
        return new Response(undefined, { status: 503, statusText: "Service Unavailable" });
      }, () => getRemoteIntegrationToolDiscovery());
    });

    assertEquals(fetchCalls, 0);
    assertEquals(result, { status: "unavailable", reason: "request_failed" });
    assertEquals(records.map((entry) => entry.level), ["error"]);
  });

  it("keys the per-run discovery cache by credential and project", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    const results = await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        fetchCalls++;
        const authorization = request.headers.get("Authorization");
        const tenant = authorization === "Bearer tenant-a-token" ? "a" : "b";
        const project = request.headers.get("x-veryfront-project-slug") ?? "none";
        return Response.json({
          tools: [{
            name: `github__tenant_${tenant}_${project}`,
            description: `Tenant ${tenant} ${project}`,
            inputSchema: {},
          }],
        });
      },
      () =>
        runWithRemoteIntegrationToolDiscoveryScope(async () => {
          const tenantA = await getRemoteIntegrationToolDiscovery({
            authToken: "tenant-a-token",
            projectSlug: "project-a",
          });
          const tenantARepeat = await getRemoteIntegrationToolDiscovery({
            authToken: "tenant-a-token",
            projectSlug: "project-a",
          });
          const repeatFetchCalls = fetchCalls;
          const tenantB = await getRemoteIntegrationToolDiscovery({
            authToken: "tenant-b-token",
            projectSlug: "project-a",
          });
          const projectB = await getRemoteIntegrationToolDiscovery({
            authToken: "tenant-a-token",
            projectSlug: "project-b",
          });
          return { tenantA, tenantARepeat, repeatFetchCalls, tenantB, projectB };
        }),
    );

    const tenantACatalog: RemoteIntegrationToolDiscoveryResult = {
      status: "ok",
      tools: [{
        name: "github__tenant_a_project-a",
        description: "Tenant a project-a",
        parameters: { type: "object", properties: {} },
      }],
    };

    assertEquals(
      results.repeatFetchCalls,
      1,
      "repeating the same credential and project must hit the per-run cache",
    );
    assertEquals(
      fetchCalls,
      3,
      "different credentials and projects must independently miss the per-run cache",
    );
    assertEquals(results.tenantA, tenantACatalog, "tenant A must receive its own catalog");
    assertEquals(
      results.tenantARepeat,
      tenantACatalog,
      "the cached tenant A catalog must be replayed unchanged",
    );
    assertEquals(
      results.tenantB,
      {
        status: "ok",
        tools: [{
          name: "github__tenant_b_project-a",
          description: "Tenant b project-a",
          parameters: { type: "object", properties: {} },
        }],
      },
      "a different credential with the same project must never be served tenant A's catalog",
    );
    assertEquals(
      results.projectB,
      {
        status: "ok",
        tools: [{
          name: "github__tenant_a_project-b",
          description: "Tenant a project-b",
          parameters: { type: "object", properties: {} },
        }],
      },
      "the same credential with a different project must miss the per-run cache",
    );
  });

  it("caches a persistent failure for the current run and retries the next run", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    // The first run's API outage persists through every bounded retry so the
    // run degrades; the outage ends before the next run starts.
    let fetchCalls = 0;
    const outcome = await withMockFetch(async () => {
      fetchCalls++;
      return fetchCalls <= MAX_INTEGRATION_TOOL_LIST_ATTEMPTS
        ? new Response(undefined, { status: 503, statusText: "Service Unavailable" })
        : Response.json({ tools: [] });
    }, async () => ({
      currentRun: await runWithRemoteIntegrationToolDiscoveryScope(async () => [
        await getRemoteIntegrationToolDiscovery(),
        await getRemoteIntegrationToolDiscovery(),
      ]),
      nextRun: await runWithRemoteIntegrationToolDiscoveryScope(() =>
        getRemoteIntegrationToolDiscovery()
      ),
    }));

    assertEquals(
      fetchCalls,
      MAX_INTEGRATION_TOOL_LIST_ATTEMPTS + 1,
      "the second discovery in the first run must replay the cached failure, not refetch",
    );
    assertEquals(outcome.currentRun, [
      { status: "unavailable", reason: "request_failed" },
      { status: "unavailable", reason: "request_failed" },
    ]);
    assertEquals(outcome.nextRun, { status: "ok", tools: [] });
  });

  it("prefers the request-scoped token and normalizes empty input schemas", async () => {
    setRemoteToolEnv({
      PROXY_MODE: "1",
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
      VERYFRONT_PROJECT_SLUG: "environment-project",
    });

    let authorizationHeader: string | null = null;
    let projectSlugHeader: string | null = null;

    const definitions = await runWithRequestContext(
      {
        projectSlug: "request-project",
        token: "request-token",
        productionMode: false,
      },
      async () =>
        await withMockFetch(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            authorizationHeader = request.headers.get("Authorization");
            projectSlugHeader = request.headers.get("x-veryfront-project-slug");

            return Response.json({
              tools: [
                {
                  name: "github__list_repos",
                  description: "List repos",
                  inputSchema: {},
                },
                {
                  name: "github__get_repo",
                  description: "Get repo",
                  inputSchema: {
                    type: "object",
                    properties: { owner: { type: "string" } },
                  },
                },
              ],
            });
          },
          async () => await getRemoteIntegrationToolDefinitions(),
        ),
    );

    assertEquals(authorizationHeader, "Bearer request-token");
    assertEquals(projectSlugHeader, "request-project");
    assertEquals(definitions, [
      {
        name: "github__list_repos",
        description: "List repos",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "github__get_repo",
        description: "Get repo",
        parameters: {
          type: "object",
          properties: { owner: { type: "string" } },
        },
      },
    ]);
  });

  it("prefers explicit authenticated tool context over host credentials", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "environment-token",
      VERYFRONT_PROJECT_SLUG: "environment-project",
    });

    let authorizationHeader: string | null = null;
    let projectSlugHeader: string | null = null;

    const definitions = await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        authorizationHeader = request.headers.get("Authorization");
        projectSlugHeader = request.headers.get("x-veryfront-project-slug");
        return Response.json({ tools: [] });
      },
      () =>
        getRemoteIntegrationToolDefinitions({
          authToken: "request-token",
          projectSlug: "canonical-project",
        }),
    );

    assertEquals(authorizationHeader, "Bearer request-token");
    assertEquals(projectSlugHeader, "canonical-project");
    assertEquals(definitions, []);
  });

  it("does not inherit host project scope for an explicit projectless credential", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "environment-token",
      VERYFRONT_PROJECT_SLUG: "environment-project",
    });

    let authorizationHeader: string | null = null;
    let projectSlugHeader: string | null = null;

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        authorizationHeader = request.headers.get("Authorization");
        projectSlugHeader = request.headers.get("x-veryfront-project-slug");
        return Response.json({ tools: [] });
      },
      () => getRemoteIntegrationToolDefinitions({ authToken: "request-token" }),
    );

    assertEquals(authorizationHeader, "Bearer request-token");
    assertEquals(projectSlugHeader, null);
  });

  it("does not downgrade an invalid explicit credential to the host token", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "environment-token",
      VERYFRONT_PROJECT_SLUG: "environment-project",
    });

    let fetchCalls = 0;
    const definitions = await withMockFetch(async () => {
      fetchCalls++;
      return Response.json({ tools: [] });
    }, () => getRemoteIntegrationToolDefinitions({ authToken: "   " }));

    assertEquals(fetchCalls, 0);
    assertEquals(definitions, []);
  });

  it("does not fall back when the hosted resolver owns an absent credential", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "environment-token",
      VERYFRONT_PROJECT_SLUG: "environment-project",
    });

    const hostedContext = {
      authToken: undefined,
    };
    let fetchCalls = 0;
    const outcome = await runWithRequestContext(
      {
        projectSlug: "ambient-request-project",
        token: "ambient-request-token",
        productionMode: false,
      },
      () =>
        withMockFetch(
          async () => {
            fetchCalls += 1;
            return Response.json({ tools: [] });
          },
          async () => ({
            definitions: await getRemoteIntegrationToolDefinitions(hostedContext),
            execution: await executeRemoteIntegrationTool(
              "github__list_repos",
              {},
              hostedContext,
            ),
          }),
        ),
    );

    assertEquals(Object.hasOwn(hostedContext, "authToken"), true);
    assertEquals(Object.hasOwn(hostedContext, "projectId"), false);
    assertEquals(Object.hasOwn(hostedContext, "projectSlug"), false);
    assertEquals(fetchCalls, 0);
    assertEquals(outcome, {
      definitions: [],
      execution: { error: "no_api_token", message: "No API token available" },
    });
  });

  it("discards failed tool-discovery response bodies before failing closed", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "environment-token",
    });

    let bodyCancelled = false;
    const definitions = await withMockFetch(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              bodyCancelled = true;
            },
          }),
          { status: 401, statusText: "Unauthorized" },
        ),
      () => getRemoteIntegrationToolDefinitions(),
    );

    assertEquals(definitions, []);
    assertEquals(bodyCancelled, true);
  });

  it("filters remote tool discovery through the active source integration policy", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const policy = normalizeSourceIntegrationPolicy({
      allow: { github: { allowedTools: ["list_repos"] } },
    });
    const definitions = await runWithExactSourceIntegrationPolicy(
      policy,
      () =>
        withMockFetch(
          async () =>
            Response.json({
              tools: [
                {
                  name: "github__list_repos",
                  description: "List repos",
                  inputSchema: {},
                },
                {
                  name: "github__delete_repo",
                  description: "Delete repo",
                  inputSchema: {},
                },
                {
                  name: "confluence__get_page",
                  description: "Get page",
                  inputSchema: {},
                },
              ],
            }),
          () => getRemoteIntegrationToolDefinitions(),
        ),
    );

    assertEquals(definitions.map((definition) => definition.name), [
      "github__list_repos",
    ]);
  });

  it("rejects source-disallowed remote execution before dispatch", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const policy = normalizeSourceIntegrationPolicy({
      allow: { github: { allowedTools: ["list_repos"] } },
    });
    let dispatchCalls = 0;

    await assertRejects(
      () =>
        runWithExactSourceIntegrationPolicy(
          policy,
          () =>
            withMockFetch(
              async () => {
                dispatchCalls++;
                return Response.json({ structuredContent: { deleted: true } });
              },
              () => executeRemoteIntegrationTool("github__delete_repo", {}),
            ),
        ),
      Error,
      'Tool "github__delete_repo" is not allowed by the source integration policy',
    );
    assertEquals(dispatchCalls, 0);
  });

  it("rejects non-canonical remote tool names before dispatch", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });
    let dispatchCalls = 0;

    await assertRejects(
      () =>
        withMockFetch(
          async () => {
            dispatchCalls++;
            return Response.json({ structuredContent: {} });
          },
          () => executeRemoteIntegrationTool("github:list-repos", {}),
        ),
      Error,
      'Remote integration tool "github:list-repos" must use the canonical integration__tool_id name',
    );
    assertEquals(dispatchCalls, 0);
  });

  it("rejects oversized remote tool names at the input bound before dispatch", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });
    let dispatchCalls = 0;

    await assertRejects(
      () =>
        withMockFetch(
          async () => {
            dispatchCalls++;
            return Response.json({ structuredContent: {} });
          },
          () => executeRemoteIntegrationTool(`github__${"a".repeat(121)}`, {}),
        ),
      Error,
      "Remote integration tool name must not exceed 128 characters",
    );
    assertEquals(dispatchCalls, 0);
  });

  it("uses the environment token only in single-project mode", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let authorizationHeader: string | null = null;
    const definitions = await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        authorizationHeader = request.headers.get("Authorization");
        return Response.json({ tools: [] });
      },
      async () => await getRemoteIntegrationToolDefinitions(),
    );

    assertEquals(authorizationHeader, "Bearer env-token");
    assertEquals(definitions, []);
  });

  it("uses the environment project slug when no request context is active", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
      VERYFRONT_PROJECT_SLUG: "environment-project",
    });

    let projectSlugHeader: string | null = null;
    const definitions = await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        projectSlugHeader = request.headers.get("x-veryfront-project-slug");
        return Response.json({ tools: [] });
      },
      async () => await getRemoteIntegrationToolDefinitions(),
    );

    assertEquals(projectSlugHeader, "environment-project");
    assertEquals(definitions, []);
  });

  it("does not fall back to the environment project slug when request context has an empty slug", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
      VERYFRONT_PROJECT_SLUG: "environment-project",
    });

    let projectSlugHeader: string | null = "unexpected";
    const definitions = await runWithRequestContext(
      { projectSlug: "   ", token: "request-token" },
      async () =>
        await withMockFetch(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            projectSlugHeader = request.headers.get("x-veryfront-project-slug");
            return Response.json({ tools: [] });
          },
          async () => await getRemoteIntegrationToolDefinitions(),
        ),
    );

    assertEquals(projectSlugHeader, null);
    assertEquals(definitions, []);
  });

  it("omits the project slug header when no project context is configured", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let projectSlugHeader: string | null = "unexpected";
    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        projectSlugHeader = request.headers.get("x-veryfront-project-slug");
        return Response.json({ tools: [] });
      },
      async () => await getRemoteIntegrationToolDefinitions(),
    );

    assertEquals(projectSlugHeader, null);
  });

  it("fails closed when the API lists a legacy integration tool alias", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const definitions = await withMockFetch(async () =>
      Response.json({
        tools: [{
          name: "github:list-repos",
          description: "Legacy alias",
          inputSchema: { type: "object", properties: {} },
        }],
      }), async () => await getRemoteIntegrationToolDefinitions());

    assertEquals(definitions, []);
  });

  it("fails closed in proxy mode without a request context", async () => {
    setRemoteToolEnv({
      PROXY_MODE: "1",
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    const definitions = await withMockFetch(async () => {
      fetchCalls++;
      return Response.json({ tools: [] });
    }, async () => await getRemoteIntegrationToolDefinitions());

    assertEquals(fetchCalls, 0);
    assertEquals(definitions, []);
  });

  for (const invalidToken of ["", "   ", 42] as const) {
    it(`fails closed in proxy mode for invalid request token ${JSON.stringify(invalidToken)}`, async () => {
      setRemoteToolEnv({
        PROXY_MODE: "1",
        VERYFRONT_API_BASE_URL: "https://api.test",
        VERYFRONT_API_TOKEN: "env-token",
      });

      let fetchCalls = 0;
      const outcome = await runWithRequestContext(
        {
          projectSlug: "request-project",
          token: invalidToken as unknown as string,
          productionMode: false,
        },
        async () =>
          await withMockFetch(async () => {
            fetchCalls++;
            return Response.json({ tools: [] });
          }, async () => ({
            definitions: await getRemoteIntegrationToolDefinitions(),
            execution: await executeRemoteIntegrationTool("github__list_repos", {}),
          })),
      );

      assertEquals(fetchCalls, 0);
      assertEquals(outcome, {
        definitions: [],
        execution: { error: "no_api_token", message: "No API token available" },
      });
    });
  }

  it("rejects an invalid environment token in single-project mode", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "   ",
    });

    let fetchCalls = 0;
    const definitions = await withMockFetch(async () => {
      fetchCalls++;
      return Response.json({ tools: [] });
    }, async () => await getRemoteIntegrationToolDefinitions());

    assertEquals(fetchCalls, 0);
    assertEquals(definitions, []);
  });

  it("does not downgrade an invalid request credential to the environment token", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    const definitions = await runWithRequestContext(
      { projectSlug: "request-project", token: "   " },
      async () =>
        await withMockFetch(async () => {
          fetchCalls++;
          return Response.json({ tools: [] });
        }, async () => await getRemoteIntegrationToolDefinitions()),
    );

    assertEquals(fetchCalls, 0);
    assertEquals(definitions, []);
  });

  it("returns structured MCP errors without flattening JSON payloads", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let requestBody: Record<string, unknown> | undefined;

    const result = await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requestBody = await request.json();

        return Response.json({
          isError: true,
          content: [{
            text: JSON.stringify({
              error: "authentication_required",
              connectUrl: "/api/auth/github",
            }),
          }],
        });
      },
      async () =>
        await executeRemoteIntegrationTool(
          "github__list_repos",
          { visibility: "private" },
        ),
    );

    assertEquals(requestBody, {
      arguments: { visibility: "private" },
    });
    assertEquals(result, {
      error: "authentication_required",
      connectUrl: "/api/auth/github",
    });
  });

  it("rejects a malformed MCP error marker instead of reporting success", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    await withMockFetch(
      async () =>
        Response.json({
          isError: "true",
          content: [{ type: "text", text: "permission denied" }],
        }),
      () =>
        assertRejects(
          () => executeRemoteIntegrationTool("github__list_repos", {}),
          TypeError,
          "malformed MCP error marker",
          "a non-boolean isError must not be coerced into a successful tool result",
        ),
    );

    const structuredError = await withMockFetch(
      async () =>
        Response.json({
          isError: true,
          content: [{
            type: "text",
            text: JSON.stringify({ error: "authentication_required" }),
          }],
        }),
      () => executeRemoteIntegrationTool("github__list_repos", {}),
    );

    assertEquals(
      structuredError,
      { error: "authentication_required" },
      "a well-formed MCP error must still resolve to its parsed structured payload",
    );
  });

  it("addresses execution by integration and tool path without duplicating identity in the body", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let requestUrl = "";
    let requestMethod = "";
    let requestBody: Record<string, unknown> | undefined;
    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requestUrl = request.url;
        requestMethod = request.method;
        requestBody = await request.json();
        return Response.json({ structuredContent: { ok: true } });
      },
      () =>
        executeRemoteIntegrationTool(
          "google-analytics__run_report",
          { property: "properties/123" },
          { runId: "run-123", agentId: "agent-123" },
        ),
    );

    assertEquals(
      requestUrl,
      "https://api.test/integrations/google-analytics/tools/run_report/call",
    );
    assertEquals(requestMethod, "POST");
    assertEquals(requestBody, {
      arguments: { property: "properties/123" },
      run_id: "run-123",
      agent_id: "agent-123",
    });
  });

  it("rejects noncanonical run and agent identifiers before any request", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    for (const context of [{ runId: "run\n1" }, { runId: " run-1 " }, { agentId: "" }]) {
      await withMockFetch(
        async () => {
          fetchCalls++;
          return Response.json({ structuredContent: { ok: true } });
        },
        () =>
          assertRejects(
            () => executeRemoteIntegrationTool("github__list_repos", {}, context),
            TypeError,
            "must be a canonical identifier",
            "a noncanonical run or agent identity must be rejected",
          ),
      );
    }

    assertEquals(
      fetchCalls,
      0,
      "a noncanonical identity must fail before the integrations API is called",
    );
  });

  it("forwards the request project slug when executing a remote integration tool", async () => {
    setRemoteToolEnv({
      PROXY_MODE: "1",
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
      VERYFRONT_PROJECT_SLUG: "environment-project",
    });

    let projectSlugHeader: string | null = null;
    const result = await runWithRequestContext(
      {
        projectSlug: "request-project",
        token: "request-token",
        productionMode: false,
      },
      async () =>
        await withMockFetch(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            projectSlugHeader = request.headers.get("x-veryfront-project-slug");
            return Response.json({ content: [], structuredContent: { ok: true } });
          },
          async () => await executeRemoteIntegrationTool("github__list_repos", {}),
        ),
    );

    assertEquals(projectSlugHeader, "request-project");
    assertEquals(result, { ok: true });
  });

  it("forwards explicit authenticated project, run, and agent context", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "environment-token",
      VERYFRONT_PROJECT_SLUG: "environment-project",
    });

    let requestBody: Record<string, unknown> | undefined;
    let authorizationHeader: string | null = null;
    let projectSlugHeader: string | null = null;

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        authorizationHeader = request.headers.get("Authorization");
        projectSlugHeader = request.headers.get("x-veryfront-project-slug");
        requestBody = await request.json();

        return Response.json({ structuredContent: { ok: true } });
      },
      async () =>
        await executeRemoteIntegrationTool(
          "gmail__list_emails",
          { maxResults: 10 },
          {
            runId: "run-123",
            agentId: "agent-123",
            authToken: "request-token",
            projectSlug: "canonical-project",
          },
        ),
    );

    assertEquals(authorizationHeader, "Bearer request-token");
    assertEquals(projectSlugHeader, "canonical-project");
    assertEquals(requestBody, {
      arguments: { maxResults: 10 },
      run_id: "run-123",
      agent_id: "agent-123",
    });
  });

  it("suppresses run_id only on strict false, not on other falsy markers", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "environment-token",
      VERYFRONT_PROJECT_SLUG: "environment-project",
    });

    for (const marker of [true, undefined, 0, "false"]) {
      let requestBody: Record<string, unknown> | undefined;
      await withMockFetch(
        async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          requestBody = await request.json();
          return Response.json({ structuredContent: { ok: true } });
        },
        async () =>
          await executeRemoteIntegrationTool("gmail__list_emails", {}, {
            runId: "run-platform-123",
            runIdBindsToolAuthorization: marker as boolean | undefined,
          }),
      );

      assertEquals(
        (requestBody as { run_id?: string } | undefined)?.run_id,
        "run-platform-123",
      );
    }
  });

  it("omits a non-binding run ID while retaining other call metadata", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "environment-token",
    });

    let requestBody: Record<string, unknown> | undefined;
    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requestBody = await request.json();
        return Response.json({ structuredContent: { ok: true } });
      },
      async () =>
        await executeRemoteIntegrationTool(
          "gmail__list_emails",
          { maxResults: 10 },
          {
            runId: "run-local-123",
            runIdBindsToolAuthorization: false,
            agentId: "agent-123",
          },
        ),
    );

    assertEquals(requestBody, {
      arguments: { maxResults: 10 },
      agent_id: "agent-123",
    });
  });

  it("prefers structuredContent for MCP error results without text content", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const result = await withMockFetch(async () =>
      Response.json({
        isError: true,
        content: [],
        structuredContent: {
          error: "authentication_required",
          integration: "linear",
          connectUrl: "/oauth/connect/linear?projectId=project-1",
          message: "Authentication required for Linear.",
        },
      }), async () => await executeRemoteIntegrationTool("linear__search_issues", { query: "*" }));

    assertEquals(result, {
      error: "authentication_required",
      integration: "linear",
      connectUrl: "/oauth/connect/linear?projectId=project-1",
      message: "Authentication required for Linear.",
    });
  });

  it("preserves protocol-relative auth URL authority from structured tool results", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const result = await withMockFetch(async () =>
      Response.json({
        content: [],
        structuredContent: {
          error: "authentication_required",
          connectUrl: "//auth.example.com/oauth/connect/github?projectId=project-1",
        },
      }), async () => await executeRemoteIntegrationTool("github__list_repos", {}));

    assertEquals(result, {
      error: "authentication_required",
      connectUrl: "//auth.example.com/oauth/connect/github?projectId=project-1",
    });
  });

  it("returns structured content from remote tool calls and detects remote names", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const result = await withMockFetch(async () =>
      Response.json({
        content: [{ text: '{"ignored":true}' }],
        structuredContent: { repos: ["veryfront"] },
      }), async () => await executeRemoteIntegrationTool("github__list_repos", {}));

    assertEquals(result, { repos: ["veryfront"] });
    assertStrictEquals(isRemoteIntegrationTool("github__list_repos"), true);
    assertStrictEquals(isRemoteIntegrationTool("github:list-repos"), false);
    assertStrictEquals(isRemoteIntegrationTool("list_repos"), false);
    assertStrictEquals(isRemoteIntegrationTool("__start"), false);
    assertStrictEquals(isRemoteIntegrationTool("end__"), false);
    assertStrictEquals(isRemoteIntegrationTool("middle__middle__name"), false);
    assertStrictEquals(isRemoteIntegrationTool(`github__${"a".repeat(121)}`), false);
  });

  it("omits undefined call tool text entries when joining text content", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const result = await withMockFetch(async () =>
      Response.json({
        content: [{ text: undefined }, { text: "plain result" }],
      }), async () => await executeRemoteIntegrationTool("github__list_repos", {}));

    assertEquals(result, "plain result");
  });

  it("reports a projectless integration tools rejection below error level", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const records = await captureIntegrationDiscoveryLogs(() =>
      withMockFetch(
        async () => new Response(undefined, { status: 400, statusText: "Bad Request" }),
        () => getRemoteIntegrationToolDiscovery(),
      )
    );

    assertEquals(records.filter((entry) => entry.level === "error"), []);
    assertEquals(records.map((entry) => entry.level), ["debug"]);
  });

  it("still reports integration tool discovery failures for a project-scoped runtime", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
      VERYFRONT_PROJECT_SLUG: "environment-project",
    });

    const records = await captureIntegrationDiscoveryLogs(() =>
      withMockFetch(
        async () => new Response(undefined, { status: 400, statusText: "Bad Request" }),
        () => getRemoteIntegrationToolDiscovery(),
      )
    );

    assertEquals(records.map((entry) => entry.level), ["error"]);
  });

  it("still reports integration tool discovery server failures at error level", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    let result: RemoteIntegrationToolDiscoveryResult | undefined;
    const records = await captureIntegrationDiscoveryLogs(async () => {
      result = await withMockFetch(
        async () => {
          fetchCalls++;
          return new Response(undefined, {
            status: 500,
            statusText: "Internal Server Error",
          });
        },
        () => getRemoteIntegrationToolDiscovery(),
      );
    });

    // Bounded retries emit debug breadcrumbs before the failure is reported.
    assertEquals(fetchCalls, MAX_INTEGRATION_TOOL_LIST_ATTEMPTS);
    assertEquals(result, { status: "unavailable", reason: "request_failed" });
    assertEquals(
      records.filter((entry) => entry.level === "error").length,
      1,
      "a persistent server failure must be reported at error level exactly once",
    );
    assertEquals(
      records.filter((entry) => entry.level === "error").map((entry) => entry.message),
      [DISCOVERY_FAILURE_MESSAGE],
      "persistent failure must preserve the exact Sentry grouping signature",
    );
    assertEquals(
      records.filter((entry) => entry.level !== "error").map((entry) => entry.level),
      Array.from({ length: MAX_INTEGRATION_TOOL_LIST_ATTEMPTS - 1 }, () => "debug"),
      "retry attempts must log at debug level only",
    );
  });
});
