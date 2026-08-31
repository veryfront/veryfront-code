import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it as bddIt } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { HandlerContext } from "#veryfront/types";
import {
  __injectDepsForTests,
  type APIRoute,
  APIRouteHandler,
  sanitizeLoadErrorForResponse,
} from "./handler.ts";
import { __resetPoolForTests } from "#veryfront/security/sandbox/worker-pool.ts";
import { __setCompiledBinaryForTests } from "#veryfront/security/sandbox/isolation-capability.ts";
import { HOST_PROJECT_EXECUTION_OVERRIDE_ENV } from "#veryfront/security/host-execution-policy.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import type { ApplicationIdentity } from "#veryfront/security/application-auth/types.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";

const handlers: APIRouteHandler[] = [];
const workerDenoEnvGet = "Deno" + ".env.get";
const DENO_ONLY_TEST_NAMES = new Set([
  "prepares without host import and executes top-level code in an env-denied worker",
  "passes admitted identity through isolated prepared App Router execution",
  "passes admitted identity through isolated prepared Pages Router execution",
  "prepares local routes before execution when API isolation is enabled",
  "authenticates an explicit OPTIONS handler but keeps automatic preflight public",
  "does not reuse prepared method capability across worker semantics",
  "dispatches a named OPTIONS handler from a prepared route",
]);

function it(name: string, fn: () => void | Promise<void>): void {
  bddIt(name, DENO_ONLY_TEST_NAMES.has(name) ? { ignore: !isDeno } : {}, fn);
}

type HandlerConfig = ConstructorParameters<typeof APIRouteHandler>[2];

function createHandler(
  projectDir: string,
  adapter?: ReturnType<typeof createMockAdapter>,
  config?: HandlerConfig,
): APIRouteHandler {
  const handler = new APIRouteHandler(projectDir, adapter, config);
  handlers.push(handler);
  return handler;
}

async function createInitializedHandler(
  projectDir: string,
  adapter: ReturnType<typeof createMockAdapter>,
  config?: HandlerConfig,
): Promise<APIRouteHandler> {
  const handler = createHandler(projectDir, adapter, config);
  await handler.initialize();
  return handler;
}

function localContext(adapter: ReturnType<typeof createMockAdapter>): HandlerContext {
  return {
    projectDir: "/test/project",
    adapter,
    securityConfig: null,
    isLocalProject: true,
  };
}

function createIdentity(): ApplicationIdentity {
  return Object.freeze({
    issuer: "veryfront:trusted-proxy",
    subject: "user-123",
    email: "user@example.test",
    groups: Object.freeze(["admin"]),
    roles: Object.freeze([]),
    groupsComplete: true,
    claims: Object.freeze({ sub: "user-123" }),
  });
}

async function prepareSource(source: string): Promise<{ source: string; sha256: string }> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return {
    source,
    sha256: bytesToHex(new Uint8Array(digest)),
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** App routes receive (request, ctx); Pages routes receive (ctx). */
function routeParamsOf(first: unknown, second?: unknown): unknown {
  const candidate = second ?? first;
  if (candidate && typeof candidate === "object" && "params" in candidate) {
    return (candidate as { params?: unknown }).params ?? null;
  }
  return null;
}

/** Serve every discovered route from a module that echoes the matched params. */
function injectParamEchoModule(): void {
  __injectDepsForTests({
    loadHandlerModule: () =>
      Promise.resolve({
        GET: (first: unknown, second?: unknown) =>
          Response.json({ params: routeParamsOf(first, second) }),
      }),
  });
}

afterEach(async (): Promise<void> => {
  while (handlers.length) handlers.pop()?.destroy();
  __injectDepsForTests(null);
  await __resetPoolForTests();
  deleteEnv("WORKER_ISOLATION_ENABLED");
  deleteEnv("WORKER_ISOLATION_API");
});

describe("APIRouteHandler", () => {
  describe("initialization", () => {
    it("should initialize without errors when directories are missing", async () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);

      await handler.initialize();

      assertExists(handler);
    });

    it("should initialize with provided adapter", () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);

      assertExists(handler);
    });

    it("should initialize without adapter and lazy-load it", () => {
      const handler = createHandler("/test/project");

      assertExists(handler);
    });
  });

  describe("request handling - unmatched routes", () => {
    it("should return null for non-API routes", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/about");
      const response = await handler.handle(request);

      assertEquals(response, null, "Non-API routes should return null");
    });

    it("should return null for unmatched non-API OPTIONS routes", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const response = await handler.handle(
        new Request("http://localhost/not-an-api-route", { method: "OPTIONS" }),
      );

      assertEquals(response, null);
    });

    it("should return null for unmatched non-API OPTIONS in an isolated runtime", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const response = await handler.handle(
        new Request("http://localhost/not-an-api-route", {
          method: "OPTIONS",
          headers: {
            origin: "https://client.example",
            "access-control-request-method": "GET",
          },
        }),
        {
          projectDir: "/test/project",
          adapter,
          securityConfig: null,
          isLocalProject: false,
          prepareHostedConfigContext: () =>
            Promise.reject(new Error("hosted config must not be evaluated")),
        },
      );

      assertEquals(response, null);
    });

    it("should return null for root path", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/");
      const response = await handler.handle(request);

      assertEquals(response, null, "Root path should return null when not an API route");
    });

    it("should return 404 for unmatched /api routes", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/api/notfound");
      const response = await handler.handle(request);

      assertExists(response, "Should return a response for /api paths");
      assertEquals(response.status, 404, "Should return 404 for unmatched API routes");
      assertEquals(await response.text(), "Not Found");
    });

    it("should return 404 for exact /api path when no route matches", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/api");
      const response = await handler.handle(request);

      assertEquals(response?.status, 404);
    });

    it("should return 404 for nested unmatched /api routes", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/api/v1/users/123/posts/456");
      const response = await handler.handle(request);

      assertEquals(response?.status, 404);
    });
  });

  describe("application request boundary", () => {
    it("strips dynamic application identity headers before host route execution", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/profile/route.ts",
        "export function GET() { return new Response('unused'); }",
      );
      __injectDepsForTests({
        loadHandlerModule: () =>
          Promise.resolve({
            GET: (request: Request, ctx: { identity: ApplicationIdentity | null }) =>
              Response.json({
                identity: ctx.identity,
                subject: request.headers.get("x-auth-subject"),
                email: request.headers.get("x-auth-email"),
                authorization: request.headers.get("authorization"),
              }),
          }),
      });

      const handler = await createInitializedHandler("/test/project", adapter);
      const identity = createIdentity();
      const response = await handler.handle(
        new Request("http://localhost/api/profile", {
          headers: {
            authorization: "Bearer application-token",
            "X-Auth-Subject": "forged-user",
            "x-auth-email": "forged@example.test",
          },
        }),
        {
          ...localContext(adapter),
          applicationIdentity: identity,
          applicationIdentityHeaderNames: ["x-auth-subject", "x-auth-email"],
        },
      );

      assertEquals(await response?.json(), {
        identity,
        subject: null,
        email: null,
        authorization: "Bearer application-token",
      });
    });
  });

  describe("remote execution isolation", () => {
    it("rejects shared-runtime API execution before preparing or starting a Worker", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/isolation/route.ts",
        "export function GET() { return new Response('must-not-run'); }",
      );
      let hostLoads = 0;
      let preparations = 0;
      __injectDepsForTests({
        loadHandlerModule: () => {
          hostLoads++;
          throw new Error("shared tenant reached host import");
        },
        prepareHandlerModule: () => {
          preparations++;
          throw new Error("shared tenant reached same-process worker preparation");
        },
      });

      const handler = await createInitializedHandler("/test/project", adapter);
      const response = await handler.handle(
        new Request("http://localhost/api/isolation"),
        {
          projectDir: "/test/project",
          adapter,
          securityConfig: null,
          isLocalProject: false,
          prepareHostedConfigContext: () =>
            Promise.reject(new Error("hosted config must not be evaluated")),
        },
      );

      assertEquals(response?.status, 503);
      assertEquals(response?.headers.get("cache-control"), "no-store");
      assertEquals(hostLoads, 0);
      assertEquals(preparations, 0);
    });

    it("prepares without host import and executes top-level code in an env-denied worker", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/isolation/route.ts",
        "export function GET() { return new Response('discovery-only'); }",
      );

      const marker = "__vf_remote_route_isolation_test__";
      delete (globalThis as Record<string, unknown>)[marker];
      const source = [
        `import "data:text/javascript,globalThis.${marker}%3D%27worker-imported%27";`,
        "let envAccess = 'allowed';",
        `try { ${workerDenoEnvGet}('VF_TEST_HOST_ONLY_SECRET'); } catch { envAccess = 'blocked'; }`,
        "export function GET(request) {",
        `  return Response.json({`,
        `    envAccess,`,
        `    marker: globalThis.${marker},`,
        `    applicationAuthorization: request.headers.get("authorization"),`,
        `    applicationCookie: request.headers.get("cookie"),`,
        `    infrastructureToken: request.headers.get("x-token"),`,
        `    projectSlug: request.headers.get("x-project-slug"),`,
        `  });`,
        "}",
      ].join("\n");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
      let hostLoads = 0;
      let preparations = 0;

      __injectDepsForTests({
        loadHandlerModule: () => {
          hostLoads++;
          throw new Error("remote project module reached host import");
        },
        prepareHandlerModule: () => {
          preparations++;
          return Promise.resolve({
            source,
            sha256: bytesToHex(new Uint8Array(digest)),
          });
        },
      });

      deleteEnv("WORKER_ISOLATION_ENABLED");
      deleteEnv("WORKER_ISOLATION_API");
      await __resetPoolForTests();
      const handler = await createInitializedHandler("/test/project", adapter);
      const remoteCtx = {
        projectDir: "/test/project",
        adapter,
        securityConfig: null,
        isLocalProject: false,
      } satisfies HandlerContext;

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          handler.handle(
            new Request("http://localhost/api/isolation", {
              headers: {
                authorization: "Bearer application-user-token",
                cookie: "session=application-cookie",
                "x-project-slug": "tenant-project",
                "x-token": "platform-service-token",
              },
            }),
            remoteCtx,
          ),
      );

      assertExists(response);
      assertEquals(response.status, 200);
      assertEquals(await response.json(), {
        applicationAuthorization: "Bearer application-user-token",
        applicationCookie: "session=application-cookie",
        envAccess: "blocked",
        infrastructureToken: null,
        marker: "worker-imported",
        projectSlug: null,
      });
      assertEquals(hostLoads, 0);
      assertEquals(preparations, 1);
      assertEquals((globalThis as Record<string, unknown>)[marker], undefined);
      assert(
        getEnv("VF_TEST_HOST_ONLY_SECRET") === undefined,
        "the test must not depend on a real host secret",
      );
    });

    it("passes admitted identity through isolated prepared App Router execution", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/isolated-identity/route.ts",
        "export function GET() { return new Response('discovery-only'); }",
      );
      const module = await prepareSource(`
        export function GET(request, ctx) {
          return Response.json({
            subject: ctx.identity?.subject ?? null,
            aliasSubject: ctx.applicationIdentity?.subject ?? null,
            identityAliasSame: ctx.identity === ctx.applicationIdentity,
            identityIsNull: ctx.identity === null,
            forgedSubject: request.headers.get("x-auth-subject"),
            authorization: request.headers.get("authorization"),
          });
        }
      `);
      __injectDepsForTests({
        loadHandlerModule: () => {
          throw new Error("isolated route reached host import");
        },
        prepareHandlerModule: () => Promise.resolve(module),
      });

      const handler = await createInitializedHandler("/test/project", adapter);
      const authenticated = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          handler.handle(
            new Request("http://localhost/api/isolated-identity", {
              headers: {
                authorization: "Bearer application-token",
                "x-auth-subject": "forged-user",
              },
            }),
            {
              projectDir: "/test/project",
              adapter,
              securityConfig: null,
              isLocalProject: false,
              applicationIdentity: createIdentity(),
              applicationIdentityHeaderNames: ["x-auth-subject"],
            },
          ),
      );
      assertEquals(await authenticated?.json(), {
        subject: "user-123",
        aliasSubject: "user-123",
        identityAliasSame: true,
        identityIsNull: false,
        forgedSubject: null,
        authorization: "Bearer application-token",
      });

      const anonymous = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          handler.handle(
            new Request("http://localhost/api/isolated-identity", {
              headers: { "x-auth-subject": "forged-user" },
            }),
            {
              projectDir: "/test/project",
              adapter,
              securityConfig: null,
              isLocalProject: false,
              applicationIdentity: null,
              applicationIdentityHeaderNames: ["x-auth-subject"],
            },
          ),
      );
      assertEquals(await anonymous?.json(), {
        subject: null,
        aliasSubject: null,
        identityAliasSame: true,
        identityIsNull: true,
        forgedSubject: null,
        authorization: null,
      });
    });

    it("passes admitted identity through isolated prepared Pages Router execution", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/isolated-identity.ts",
        "export function GET() { return new Response('discovery-only'); }",
      );
      const module = await prepareSource(`
        export function GET(ctx) {
          return Response.json({
            subject: ctx.identity?.subject ?? null,
            aliasSubject: ctx.applicationIdentity?.subject ?? null,
            identityAliasSame: ctx.identity === ctx.applicationIdentity,
            identityIsNull: ctx.identity === null,
            forgedSubject: ctx.headers.get("x-auth-subject"),
            authorization: ctx.headers.get("authorization"),
          });
        }
      `);
      __injectDepsForTests({
        loadHandlerModule: () => {
          throw new Error("isolated route reached host import");
        },
        prepareHandlerModule: () => Promise.resolve(module),
      });

      const handler = await createInitializedHandler("/test/project", adapter);
      const authenticated = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          handler.handle(
            new Request("http://localhost/api/isolated-identity", {
              headers: {
                authorization: "Bearer application-token",
                "x-auth-subject": "forged-user",
              },
            }),
            {
              projectDir: "/test/project",
              adapter,
              securityConfig: null,
              isLocalProject: false,
              applicationIdentity: createIdentity(),
              applicationIdentityHeaderNames: ["x-auth-subject"],
            },
          ),
      );
      assertEquals(await authenticated?.json(), {
        subject: "user-123",
        aliasSubject: "user-123",
        identityAliasSame: true,
        identityIsNull: false,
        forgedSubject: null,
        authorization: "Bearer application-token",
      });

      const anonymous = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          handler.handle(
            new Request("http://localhost/api/isolated-identity", {
              headers: { "x-auth-subject": "forged-user" },
            }),
            {
              projectDir: "/test/project",
              adapter,
              securityConfig: null,
              isLocalProject: false,
              applicationIdentity: null,
              applicationIdentityHeaderNames: ["x-auth-subject"],
            },
          ),
      );
      assertEquals(await anonymous?.json(), {
        subject: null,
        aliasSubject: null,
        identityAliasSame: true,
        identityIsNull: true,
        forgedSubject: null,
        authorization: null,
      });
    });

    it("keeps local development on the host-compatible route path", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/local.ts",
        "export function GET() { return new Response('local'); }",
      );
      let hostLoads = 0;
      let preparations = 0;
      __injectDepsForTests({
        loadHandlerModule: () => {
          hostLoads++;
          return Promise.resolve({
            GET: (request: Request) =>
              Response.json({
                authorization: request.headers.get("authorization"),
                infrastructureToken: request.headers.get("x-token"),
              }),
          });
        },
        prepareHandlerModule: () => {
          preparations++;
          throw new Error("local development should not prepare a worker module");
        },
      });

      const handler = await createInitializedHandler("/test/project", adapter);
      const response = await handler.handle(
        new Request("http://localhost/api/local", {
          headers: {
            authorization: "Bearer local-application-token",
            "x-token": "local-infrastructure-token",
          },
        }),
        {
          projectDir: "/test/project",
          adapter,
          securityConfig: null,
          isLocalProject: true,
        },
      );

      assertEquals(response?.status, 200);
      assertEquals(await response?.json(), {
        authorization: "Bearer local-application-token",
        infrastructureToken: null,
      });
      assertEquals(hostLoads, 1);
      assertEquals(preparations, 0);
    });

    it("allows an explicitly capable dedicated runtime to use the host route path", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/dedicated.ts",
        "export function GET() { return new Response('dedicated'); }",
      );
      let hostLoads = 0;
      let preparations = 0;
      __injectDepsForTests({
        loadHandlerModule: () => {
          hostLoads++;
          return Promise.resolve({
            GET: () => new Response("dedicated"),
          });
        },
        prepareHandlerModule: () => {
          preparations++;
          throw new Error("dedicated runtime should not prepare a worker module");
        },
      });

      const handler = await createInitializedHandler("/test/project", adapter);
      const response = await handler.handle(
        new Request("http://localhost/api/dedicated"),
        {
          projectDir: "/test/project",
          adapter,
          securityConfig: null,
          isLocalProject: false,
          allowHostProjectCodeExecution: true,
        },
      );

      assertEquals(response?.status, 200);
      assertEquals(await response?.text(), "dedicated");
      assertEquals(hostLoads, 1);
      assertEquals(preparations, 0);
    });

    it("prepares local routes before execution when API isolation is enabled", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/local-isolated.ts",
        "export function GET() { return new Response('discovery-only'); }",
      );
      const source = `export function GET() { return new Response("local-isolated"); }`;
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
      let hostLoads = 0;
      let preparations = 0;
      __injectDepsForTests({
        loadHandlerModule: () => {
          hostLoads++;
          throw new Error("isolated local route reached host import");
        },
        prepareHandlerModule: () => {
          preparations++;
          return Promise.resolve({
            source,
            sha256: bytesToHex(new Uint8Array(digest)),
          });
        },
      });
      setEnv("WORKER_ISOLATION_ENABLED", "1");
      setEnv("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const handler = await createInitializedHandler("/test/project", adapter);
      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          handler.handle(
            new Request("http://localhost/api/local-isolated"),
            {
              projectDir: "/test/project",
              adapter,
              securityConfig: null,
              isLocalProject: true,
            },
          ),
      );

      assertEquals(response?.status, 200);
      assertEquals(await response?.text(), "local-isolated");
      assertEquals(hostLoads, 0);
      assertEquals(preparations, 1);
    });

    describe("when the runtime cannot prepare an isolated module", () => {
      afterEach(() => {
        __setCompiledBinaryForTests(undefined);
        deleteEnv(HOST_PROJECT_EXECUTION_OVERRIDE_ENV);
      });

      it("fails closed when API isolation conflicts with a host execution grant", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          "/test/project/pages/api/hosted.ts",
          "export function GET() { return new Response('discovery-only'); }",
        );
        let hostLoads = 0;
        let preparations = 0;
        __injectDepsForTests({
          loadHandlerModule: () => {
            hostLoads++;
            return Promise.resolve({
              GET: () => new Response("hosted"),
            });
          },
          prepareHandlerModule: () => {
            preparations++;
            throw new Error("prepared an isolated module this runtime cannot link");
          },
        });
        setEnv("WORKER_ISOLATION_ENABLED", "1");
        setEnv("WORKER_ISOLATION_API", "1");
        setEnv(HOST_PROJECT_EXECUTION_OVERRIDE_ENV, "1");
        __setCompiledBinaryForTests(true);
        await __resetPoolForTests();

        const handler = await createInitializedHandler("/test/project", adapter);
        const response = await handler.handle(
          new Request("http://localhost/api/hosted"),
          {
            projectDir: "/test/project",
            adapter,
            securityConfig: null,
            isLocalProject: false,
            allowHostProjectCodeExecution: true,
          },
        );

        assertEquals(response?.status, 503);
        assert(
          response?.headers.get("content-type")?.includes("application/problem+json"),
        );
        const body = await response?.json();
        assert(String(body.detail).includes("WORKER_ISOLATION_API"));
        assertEquals(hostLoads, 0);
        assertEquals(preparations, 0);
      });

      it("fails closed with a typed 503 when host execution is not granted", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          "/test/project/pages/api/hosted.ts",
          "export function GET() { return new Response('discovery-only'); }",
        );
        let hostLoads = 0;
        let preparations = 0;
        __injectDepsForTests({
          loadHandlerModule: () => {
            hostLoads++;
            throw new Error("host fallback under an ungranted isolation posture");
          },
          prepareHandlerModule: () => {
            preparations++;
            throw new Error("unreachable");
          },
        });
        setEnv("WORKER_ISOLATION_ENABLED", "1");
        setEnv("WORKER_ISOLATION_API", "1");
        // Deliberately no VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION.
        __setCompiledBinaryForTests(true);
        await __resetPoolForTests();

        const handler = await createInitializedHandler("/test/project", adapter);
        const response = await handler.handle(
          new Request("http://localhost/api/hosted"),
          {
            projectDir: "/test/project",
            adapter,
            securityConfig: null,
            isLocalProject: false,
            // Dedicated runtime capability, but no operator grant.
            allowHostProjectCodeExecution: true,
          },
        );

        assertEquals(response?.status, 503);
        assert(
          response?.headers.get("content-type")?.includes("application/problem+json"),
        );
        const body = await response?.json();
        assert(String(body.detail).includes("WORKER_ISOLATION_API"));
        assertEquals(hostLoads, 0); // no silent host-realm fallback
        assertEquals(preparations, 0); // and no masked 500 from the loader
      });
    });
  });

  describe("OPTIONS/CORS handling", () => {
    it("dispatches a named OPTIONS handler on a matched route", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/options.ts",
        "export function OPTIONS() { return new Response('unused'); }",
      );
      let routeCalls = 0;
      __injectDepsForTests({
        loadHandlerModule: () =>
          Promise.resolve({
            OPTIONS: () => {
              routeCalls++;
              return new Response("named options", {
                status: 207,
                headers: { "x-options-owner": "route" },
              });
            },
          }),
      });
      const handler = await createInitializedHandler("/test/project", adapter);

      const response = await handler.handle(
        new Request("http://localhost/api/options", { method: "OPTIONS" }),
        localContext(adapter),
      );

      assertEquals(routeCalls, 1, "the exact OPTIONS export must execute");
      assertEquals(response?.status, 207);
      assertEquals(response?.headers.get("x-options-owner"), "route");
      assertEquals(await response?.text(), "named options");
    });

    it("discovers project primitives after OPTIONS auth and before dispatch", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/options-order.ts",
        "export function OPTIONS() { return new Response('unused'); }",
      );
      const order: string[] = [];
      __injectDepsForTests({
        loadHandlerModule: () => {
          order.push("load");
          return Promise.resolve({
            OPTIONS: () => {
              order.push("dispatch");
              return new Response("ordered options");
            },
          });
        },
      });
      const handler = await createInitializedHandler("/test/project", adapter);

      const response = await handler.handle(
        new Request("http://localhost/api/options-order", { method: "OPTIONS" }),
        localContext(adapter),
        {
          beforeOptionsDispatch: async () => {
            order.push("discover");
          },
        },
      );

      assertEquals(await response?.text(), "ordered options");
      assertEquals(order, ["discover", "load", "dispatch"]);
    });

    it("dispatches a default route handler for OPTIONS", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/default-options.ts",
        "export default function handler() { return new Response('unused'); }",
      );
      __injectDepsForTests({
        loadHandlerModule: () =>
          Promise.resolve({
            default: () =>
              new Response("default options", {
                status: 208,
                headers: { "x-options-owner": "default" },
              }),
          }),
      });
      const handler = await createInitializedHandler(
        "/test/project",
        adapter,
        { security: { cors: { origin: ["https://client.example"] } } } as HandlerConfig,
      );

      const response = await handler.handle(
        new Request("http://localhost/api/default-options", {
          method: "OPTIONS",
          headers: {
            origin: "https://client.example",
            "access-control-request-method": "PROPFIND",
          },
        }),
        localContext(adapter),
      );

      assertEquals(response?.status, 208);
      assertEquals(response?.headers.get("x-options-owner"), "default");
      assertEquals(
        response?.headers.get("access-control-allow-methods"),
        "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, PROPFIND",
      );
      assertEquals(await response?.text(), "default options");
    });

    it("dispatches OPTIONS in an operator-granted shared runtime", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/granted-options.ts",
        "export function OPTIONS() {}",
      );
      let routeCalls = 0;
      __injectDepsForTests({
        loadHandlerModule: () =>
          Promise.resolve({
            OPTIONS: () => {
              routeCalls++;
              return new Response("granted options", { status: 212 });
            },
          }),
      });
      const handler = await createInitializedHandler("/test/project", adapter);

      const response = await handler.handle(
        new Request("http://localhost/api/granted-options", { method: "OPTIONS" }),
        {
          projectDir: "/test/project",
          adapter,
          securityConfig: null,
          isLocalProject: false,
          allowHostProjectCodeExecution: true,
          prepareHostedConfigContext: () => Promise.reject(new Error("unused")),
        },
      );

      assertEquals(response?.status, 212);
      assertEquals(await response?.text(), "granted options");
      assertEquals(routeCalls, 1);
    });

    it("dispatches OPTIONS for a dynamic App route with normalized params", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/hooks/[hookId]/route.ts",
        "export function OPTIONS() { return new Response('unused'); }",
      );
      __injectDepsForTests({
        loadHandlerModule: () =>
          Promise.resolve({
            OPTIONS: (first: unknown, second?: unknown) =>
              Response.json({ params: routeParamsOf(first, second) }, { status: 210 }),
          }),
      });
      const handler = await createInitializedHandler("/test/project", adapter);

      const response = await handler.handle(
        new Request("http://localhost/hooks/deploy", { method: "OPTIONS" }),
        localContext(adapter),
      );

      assertEquals(response?.status, 210);
      assertEquals(await response?.json(), { params: { hookId: "deploy" } });
    });

    it("keeps automatic preflight for a matched route without OPTIONS", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/automatic-options.ts",
        "export function GET() { return new Response('unused'); }",
      );
      __injectDepsForTests({
        loadHandlerModule: () => Promise.resolve({ GET: () => new Response("get") }),
      });
      const handler = await createInitializedHandler(
        "/test/project",
        adapter,
        { security: { cors: { origin: ["https://client.example"] } } } as HandlerConfig,
      );

      const response = await handler.handle(
        new Request("http://localhost/api/automatic-options", {
          method: "OPTIONS",
          headers: {
            origin: "https://client.example",
            "access-control-request-method": "PUT",
            "access-control-request-headers": "Authorization, X-Token, X-Project-Id, X-App-Trace",
          },
        }),
        localContext(adapter),
      );

      assertEquals(response?.status, 204);
      assertEquals(response?.body, null);
      assertEquals(response?.headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");
      assertEquals(response?.headers.get("allow"), "GET, HEAD, OPTIONS");
      assertEquals(
        response?.headers.get("access-control-allow-headers"),
        "Authorization, X-App-Trace",
      );
    });

    it("applies preflight policy headers to an explicit OPTIONS response", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/policy-options.ts",
        "export function POST() {} export function OPTIONS() {}",
      );
      __injectDepsForTests({
        loadHandlerModule: () =>
          Promise.resolve({
            POST: () => new Response("post"),
            OPTIONS: () =>
              new Response("explicit options", {
                status: 211,
                headers: {
                  "x-options-owner": "route",
                  "access-control-allow-origin": "https://untrusted.example",
                  "access-control-allow-headers": "X-Token",
                },
              }),
          }),
      });
      const handler = await createInitializedHandler(
        "/test/project",
        adapter,
        {
          security: {
            cors: {
              origin: ["https://client.example"],
              maxAge: 123,
            },
          },
        } as HandlerConfig,
      );

      const response = await handler.handle(
        new Request("http://localhost/api/policy-options", {
          method: "OPTIONS",
          headers: {
            origin: "https://client.example",
            "access-control-request-method": "POST",
            "access-control-request-headers": "Authorization, X-Token",
          },
        }),
        localContext(adapter),
      );

      assertEquals(response?.status, 211);
      assertEquals(await response?.text(), "explicit options");
      assertEquals(response?.headers.get("x-options-owner"), "route");
      assertEquals(response?.headers.get("access-control-allow-origin"), "https://client.example");
      assertEquals(response?.headers.get("access-control-allow-methods"), "POST, OPTIONS");
      assertEquals(response?.headers.get("access-control-allow-headers"), "Authorization");
      assertEquals(response?.headers.get("access-control-max-age"), "123");
    });

    it("authenticates an explicit OPTIONS handler but keeps automatic preflight public", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/protected-options.ts",
        "export function OPTIONS() {}",
      );
      let routeCalls = 0;
      let moduleLoads = 0;
      let discoveryCalls = 0;
      __injectDepsForTests({
        loadHandlerModule: () => {
          moduleLoads++;
          return Promise.resolve({
            OPTIONS: (context: unknown) => {
              routeCalls++;
              const apiContext = context as {
                identity?: { subject?: string } | null;
                headers: Headers;
              };
              return Response.json({
                subject: apiContext.identity?.subject ?? null,
                admittedHeader: apiContext.headers.get("x-auth-subject"),
              });
            },
          });
        },
      });
      const config = {
        security: {
          cors: { origin: ["https://client.example"] },
          auth: {
            trustedProxy: {
              trustedPeers: ["127.0.0.1"],
              headers: { subject: "x-auth-subject" },
            },
          },
        },
      } as HandlerConfig;
      const handler = await createInitializedHandler("/test/project", adapter, config);
      const ctx = {
        ...localContext(adapter),
        securityConfig: config?.security ?? null,
      } as HandlerContext;

      const beforeOptionsDispatch = () => {
        discoveryCalls++;
        return Promise.resolve();
      };
      const preflight = await handler.handle(
        new Request("http://localhost/api/protected-options", {
          method: "OPTIONS",
          headers: {
            origin: "https://client.example",
            "access-control-request-method": "POST",
            "x-auth-subject": "forged-user",
          },
        }),
        ctx,
        { beforeOptionsDispatch },
      );
      assertEquals(preflight?.status, 204);
      assertEquals(discoveryCalls, 0);
      assertEquals(routeCalls, 0);
      assertEquals(moduleLoads, 0, "unauthenticated preflight must not evaluate the route module");

      const admittedRequest = new Request("http://localhost/api/protected-options", {
        method: "OPTIONS",
        headers: { "x-auth-subject": "user-123" },
      });
      recordRequestPeerFromTransport(admittedRequest, {
        runtime: "deno",
        transport: "tcp",
        hostname: "127.0.0.1",
      });
      const admitted = await handler.handle(admittedRequest, ctx, { beforeOptionsDispatch });

      assertEquals(admitted?.status, 200);
      assertEquals(await admitted?.json(), {
        subject: "user-123",
        admittedHeader: null,
      });
      assertEquals(routeCalls, 1);
      assertEquals(moduleLoads, 1);
      assertEquals(discoveryCalls, 1);
    });

    it("keeps plain OPTIONS automatic when a protected route has no OPTIONS export", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/protected-get-only.ts",
        "export function GET() { return new Response('unused'); }",
      );
      let moduleLoads = 0;
      __injectDepsForTests({
        loadHandlerModule: () => {
          moduleLoads++;
          return Promise.resolve({ GET: () => new Response("get") });
        },
      });
      const securityConfig = {
        security: {
          cors: { origin: ["https://client.example"] },
          auth: { basic: { username: "admin", password: "secret" } },
        },
      }.security as HandlerContext["securityConfig"];
      const config = { security: securityConfig } as HandlerConfig;
      const handler = await createInitializedHandler("/test/project", adapter, config);
      const response = await handler.handle(
        new Request("http://localhost/api/protected-get-only", {
          method: "OPTIONS",
          headers: { origin: "https://client.example" },
        }),
        {
          ...localContext(adapter),
          securityConfig,
        },
      );

      assertEquals(response?.status, 204);
      assertEquals(moduleLoads, 0, "automatic plain OPTIONS must not evaluate the route");
    });

    it("does not reuse prepared method capability across worker semantics", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/semantic-options.ts",
        "export function OPTIONS() {}",
      );
      const module = await prepareSource(
        `export function OPTIONS() { return new Response("semantic options", { status: 213 }); }`,
      );
      let inspectedMethods = ["GET", "HEAD"];
      __injectDepsForTests({
        loadHandlerModule: () => {
          throw new Error("semantic OPTIONS route reached host import");
        },
        prepareHandlerModule: () => Promise.resolve(module),
        resolvePreparedRouteMethods: () => Promise.resolve([...inspectedMethods]),
      });
      setEnv("WORKER_ISOLATION_ENABLED", "1");
      setEnv("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();
      const handler = await createInitializedHandler("/test/project", adapter);

      const first = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          handler.handle(
            new Request("http://localhost/api/semantic-options", { method: "OPTIONS" }),
            localContext(adapter),
          ),
      );
      assertEquals(first?.status, 204);

      inspectedMethods = ["OPTIONS"];
      const second = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: { github: {} } }),
        () =>
          handler.handle(
            new Request("http://localhost/api/semantic-options", { method: "OPTIONS" }),
            localContext(adapter),
          ),
      );
      assertEquals(second?.status, 213);
      assertEquals(await second?.text(), "semantic options");
    });

    it("dispatches a named OPTIONS handler from a prepared route", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/prepared-options.ts",
        "export function OPTIONS() { return new Response('discovery-only'); }",
      );
      const module = await prepareSource(
        `export function OPTIONS() {
          return new Response("prepared options", {
            status: 209,
            headers: { "x-options-owner": "worker" },
          });
        }`,
      );
      __injectDepsForTests({
        loadHandlerModule: () => {
          throw new Error("prepared OPTIONS route reached host import");
        },
        prepareHandlerModule: () => Promise.resolve(module),
      });
      setEnv("WORKER_ISOLATION_ENABLED", "1");
      setEnv("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const handler = await createInitializedHandler("/test/project", adapter);
      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          handler.handle(
            new Request("http://localhost/api/prepared-options", { method: "OPTIONS" }),
            localContext(adapter),
          ),
      );

      assertEquals(response?.status, 209);
      assertEquals(response?.headers.get("x-options-owner"), "worker");
      assertEquals(await response?.text(), "prepared options");

      const repeated = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          handler.handle(
            new Request("http://localhost/api/prepared-options", { method: "OPTIONS" }),
            localContext(adapter),
          ),
      );
      assertEquals(repeated?.status, 209);

      handler.clearCache();
      const refreshed = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          handler.handle(
            new Request("http://localhost/api/prepared-options", { method: "OPTIONS" }),
            localContext(adapter),
          ),
      );
      assertEquals(refreshed?.status, 209);
    });

    it("returns an API error when prepared OPTIONS inspection fails", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/prepared-options-failure.ts",
        "export function GET() {}",
      );
      const module = await prepareSource("export function GET() {}\n");
      __injectDepsForTests({
        loadHandlerModule: () => {
          throw new Error("prepared route reached host import");
        },
        prepareHandlerModule: () => Promise.resolve(module),
        resolvePreparedRouteMethods: () =>
          Promise.reject(new Error("prepared method inspection failed")),
      });
      setEnv("WORKER_ISOLATION_ENABLED", "1");
      setEnv("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const handler = await createInitializedHandler("/test/project", adapter);
      __setCompiledBinaryForTests(false);
      try {
        const response = await runWithExactSourceIntegrationPolicy(
          normalizeSourceIntegrationPolicy({ allow: {} }),
          () =>
            handler.handle(
              new Request("http://localhost/api/prepared-options-failure", {
                method: "OPTIONS",
                headers: {
                  origin: "https://client.example",
                  "access-control-request-method": "POST",
                },
              }),
              {
                projectDir: "/test/project",
                adapter,
                securityConfig: null,
                isLocalProject: false,
              },
            ),
        );

        assertEquals(response?.status, 500);
        assertEquals(response?.headers.get("content-type"), "application/problem+json");
        const body = await response?.json();
        assertEquals(body.status, 500);
        assertEquals(body.title, "Unknown/unclassified error");
      } finally {
        __setCompiledBinaryForTests(undefined);
      }
    });

    it("should handle OPTIONS preflight requests with secure-by-default CORS", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/api/test", {
        method: "OPTIONS",
        headers: { origin: "https://example.com" },
      });
      const response = await handler.handle(request);

      assertExists(response, "Should return response for OPTIONS");
      assertEquals(response.status, 204, "OPTIONS should return 204");
      assertEquals(
        response.headers.get("Access-Control-Allow-Origin"),
        null,
        "Should not include CORS headers without config",
      );
    });

    it("should handle OPTIONS with no origin header", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/api/test", { method: "OPTIONS" });
      const response = await handler.handle(request);

      assertEquals(response?.status, 204);
      assertEquals(response?.headers.get("Access-Control-Allow-Origin"), null);
    });

    it("should handle OPTIONS for /api root", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: { origin: "https://example.com" },
      });
      const response = await handler.handle(request);

      assertEquals(response?.status, 204);
    });

    it("should echo a configured origin on preflight", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler(
        "/test/project",
        adapter,
        { security: { cors: { origin: ["https://example.com"] } } } as HandlerConfig,
      );

      const response = await handler.handle(
        new Request("http://localhost/api/test", {
          method: "OPTIONS",
          headers: { origin: "https://example.com" },
        }),
      );

      assertEquals(response?.status, 204, "preflight still answers 204");
      assertEquals(
        response?.headers.get("Access-Control-Allow-Origin"),
        "https://example.com",
        "a configured origin must be echoed on preflight",
      );
    });

    it("should keep configured CORS headers on the success path", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/cors.ts",
        "export function GET() { return new Response('ok'); }",
      );
      __injectDepsForTests({
        loadHandlerModule: () => Promise.resolve({ GET: () => new Response("ok") }),
      });

      const handler = await createInitializedHandler(
        "/test/project",
        adapter,
        { security: { cors: { origin: ["https://example.com"] } } } as HandlerConfig,
      );

      const allowed = await handler.handle(
        new Request("http://localhost/api/cors", {
          headers: { origin: "https://example.com" },
        }),
        localContext(adapter),
      );
      assertEquals(allowed?.status, 200, "the configured route still answers");
      assertEquals(
        allowed?.headers.get("Access-Control-Allow-Origin"),
        "https://example.com",
        "configured CORS headers must survive on the success path",
      );

      const rejected = await handler.handle(
        new Request("http://localhost/api/cors", {
          headers: { origin: "https://evil.example" },
        }),
        localContext(adapter),
      );
      assertEquals(
        rejected?.headers.get("Access-Control-Allow-Origin"),
        null,
        "a disallowed origin gets no CORS header",
      );
    });
  });

  describe("route discovery", () => {
    it("should discover Pages Router API routes", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/project";

      adapter.fs.files.set(
        "/test/project/pages/api/users.ts",
        "export async function GET() { return Response.json({ users: [] }); }",
      );
      injectParamEchoModule();

      const handler = await createInitializedHandler(projectDir, adapter);
      const response = await handler.handle(
        new Request("http://localhost/api/users"),
        localContext(adapter),
      );

      assertEquals(response?.status, 200, "a discovered Pages Router route must match");
      assertEquals(
        await response?.json(),
        { params: {} },
        "a static Pages Router route matches with no params",
      );
    });

    it("should discover App Router routes", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/project";

      adapter.fs.files.set(
        "/test/project/app/api/posts/route.ts",
        "export async function GET() { return Response.json({ posts: [] }); }",
      );
      injectParamEchoModule();

      const handler = await createInitializedHandler(projectDir, adapter);
      const response = await handler.handle(
        new Request("http://localhost/api/posts"),
        localContext(adapter),
      );

      assertEquals(response?.status, 200, "a discovered App Router route must match");
      assertEquals(
        await response?.json(),
        { params: {} },
        "a static App Router route matches with no params",
      );
    });

    it("should discover nested App Router routes", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/project";

      adapter.fs.files.set(
        "/test/project/app/api/users/[id]/posts/route.ts",
        "export async function GET() { return Response.json({ posts: [] }); }",
      );
      injectParamEchoModule();

      const handler = await createInitializedHandler(projectDir, adapter);
      const response = await handler.handle(
        new Request("http://localhost/api/users/7/posts"),
        localContext(adapter),
      );

      assertEquals(response?.status, 200, "a nested dynamic App Router route must match");
      assertEquals(
        await response?.json(),
        { params: { id: "7" } },
        "the nested dynamic segment must be extracted",
      );
    });

    it("should discover multiple routes in both routers", async () => {
      const adapter = createMockAdapter();

      adapter.fs.files.set(
        "/test/project/pages/api/auth.ts",
        "export async function POST() { return Response.json({ auth: true }); }",
      );
      adapter.fs.files.set(
        "/test/project/app/api/data/route.ts",
        "export async function GET() { return Response.json({ data: [] }); }",
      );
      __injectDepsForTests({
        loadHandlerModule: (options) =>
          Promise.resolve({
            GET: () => Response.json({ modulePath: options.modulePath }),
            POST: () => Response.json({ modulePath: options.modulePath }),
          }),
      });

      const handler = await createInitializedHandler("/test/project", adapter);
      const pagesResponse = await handler.handle(
        new Request("http://localhost/api/auth", { method: "POST" }),
        localContext(adapter),
      );
      const appResponse = await handler.handle(
        new Request("http://localhost/api/data"),
        localContext(adapter),
      );

      assertEquals(
        await pagesResponse?.json(),
        { modulePath: "/test/project/pages/api/auth.ts" },
        "the Pages Router route must resolve to its own module",
      );
      assertEquals(
        await appResponse?.json(),
        { modulePath: "/test/project/app/api/data/route.ts" },
        "the App Router route must resolve to its own module",
      );
    });
  });

  describe("cache management", () => {
    it("should provide clearCache method", () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);

      handler.clearCache();

      assertExists(handler);
    });

    it("should clear cache without errors after initialization", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/test/route.ts",
        "export async function GET() { return Response.json({}); }",
      );
      __injectDepsForTests({
        loadHandlerModule: () => Promise.resolve({ GET: () => new Response("v1") }),
      });

      const handler = await createInitializedHandler("/test/project", adapter);
      const first = await handler.handle(
        new Request("http://localhost/api/test"),
        localContext(adapter),
      );
      assertEquals(await first?.text(), "v1", "the first request serves the loaded module");

      __injectDepsForTests({
        loadHandlerModule: () => Promise.resolve({ GET: () => new Response("v2") }),
      });
      handler.clearCache();

      const second = await handler.handle(
        new Request("http://localhost/api/test"),
        localContext(adapter),
      );
      assertEquals(
        await second?.text(),
        "v2",
        "clearCache must evict the cached route module so an edited route is reloaded",
      );
    });

    it("should allow re-initialization after cache clear", async () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);

      await handler.initialize();
      handler.clearCache();
      await handler.initialize();

      assertExists(handler);
    });

    it("should defer destruction until active requests settle", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/status.ts",
        "export function GET() { return new Response('ok'); }",
      );
      __injectDepsForTests({
        loadHandlerModule: () =>
          Promise.resolve({
            GET: () => new Response("ok"),
          }),
      });
      const handler = await createInitializedHandler("/test/project", adapter);

      const localCtx = {
        projectDir: "/test/project",
        adapter,
        securityConfig: null,
        isLocalProject: true,
      } satisfies HandlerContext;
      const responsePromise = handler.handle(
        new Request("http://localhost/api/status"),
        localCtx,
      );
      handler.destroy();

      const response = await responsePromise;
      assertEquals(response?.status, 200);
      assertEquals(await response?.text(), "ok");

      const responseAfterDestroy = await handler.handle(
        new Request("http://localhost/api/status"),
        localCtx,
      );
      assertEquals(responseAfterDestroy?.status, 404);
    });
  });

  describe("error scenarios", () => {
    it("should handle file system errors during initialization gracefully", async () => {
      const adapter = createMockAdapter();
      adapter.fs.readDir = async function* () {
        yield* [];
        throw new Error("File system error");
      };

      const handler = createHandler("/test/project", adapter);

      try {
        await handler.initialize();
      } catch (e) {
        assertExists(e);
      }
    });

    it("should handle requests after failed initialization", async () => {
      const adapter = createMockAdapter();
      const originalReadDir = adapter.fs.readDir;
      let callCount = 0;

      adapter.fs.readDir = async function* (path: string) {
        callCount++;
        if (callCount === 1) throw new Error("First call fails");
        yield* originalReadDir.call(adapter.fs, path);
      };

      const handler = createHandler("/test/project", adapter);

      try {
        await handler.initialize();
      } catch {
        // ignore
      }

      const request = new Request("http://localhost/api/test");
      const response = await handler.handle(request);

      assertExists(response, "Should handle requests even after failed initialization");
    });
  });

  describe("route pattern matching", () => {
    it("should handle routes with dynamic segments", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/users/[id].ts",
        "export async function GET() { return Response.json({}); }",
      );
      injectParamEchoModule();

      const handler = await createInitializedHandler("/test/project", adapter);
      const response = await handler.handle(
        new Request("http://localhost/api/users/123"),
        localContext(adapter),
      );

      assertEquals(response?.status, 200, "a discovered dynamic route must match");
      assertEquals(
        await response?.json(),
        { params: { id: "123" } },
        "the dynamic segment must be extracted",
      );
    });

    it("should handle catch-all routes", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/files/[...path].ts",
        "export async function GET() { return Response.json({}); }",
      );
      injectParamEchoModule();

      const handler = await createInitializedHandler("/test/project", adapter);
      const response = await handler.handle(
        new Request("http://localhost/api/files/a/b"),
        localContext(adapter),
      );

      assertEquals(response?.status, 200, "a discovered catch-all route must match");
      assertEquals(
        await response?.json(),
        { params: { path: ["a", "b"] } },
        "every catch-all segment must be extracted",
      );
    });

    it("should handle optional catch-all routes", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/[[...slug]]/route.ts",
        "export async function GET() { return Response.json({}); }",
      );
      injectParamEchoModule();

      const handler = await createInitializedHandler("/test/project", adapter);
      const response = await handler.handle(
        new Request("http://localhost/api/docs/intro"),
        localContext(adapter),
      );

      assertEquals(response?.status, 200, "a discovered optional catch-all route must match");
      assertEquals(
        await response?.json(),
        { params: { slug: "docs/intro" } },
        "the optional catch-all segments must be extracted",
      );
    });
  });

  describe("HTTP method handling", () => {
    it("should accept different HTTP methods in route names", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/resource/route.ts",
        `export async function GET() { return Response.json({ method: 'GET' }); }
         export async function POST() { return Response.json({ method: 'POST' }); }
         export async function PUT() { return Response.json({ method: 'PUT' }); }
         export async function DELETE() { return Response.json({ method: 'DELETE' }); }
         export async function PATCH() { return Response.json({ method: 'PATCH' }); }`,
      );
      __injectDepsForTests({
        loadHandlerModule: () =>
          Promise.resolve({
            GET: () => Response.json({ method: "GET" }),
            POST: () => Response.json({ method: "POST" }),
            PUT: () => Response.json({ method: "PUT" }),
            DELETE: () => Response.json({ method: "DELETE" }),
            PATCH: () => Response.json({ method: "PATCH" }),
          }),
      });

      const handler = await createInitializedHandler("/test/project", adapter);

      for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
        const response = await handler.handle(
          new Request("http://localhost/api/resource", { method }),
          localContext(adapter),
        );

        assertEquals(response?.status, 200, `the discovered route must accept ${method}`);
        assertEquals(
          await response?.json(),
          { method },
          `${method} must reach its own method export`,
        );
      }
    });

    it("should support HEAD method", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/head/route.ts",
        "export async function HEAD() { return new Response(null, { status: 200 }); }",
      );
      __injectDepsForTests({
        loadHandlerModule: () =>
          Promise.resolve({
            HEAD: () => new Response(null, { status: 200 }),
          }),
      });

      const handler = await createInitializedHandler("/test/project", adapter);
      const response = await handler.handle(
        new Request("http://localhost/api/head", { method: "HEAD" }),
        localContext(adapter),
      );

      assertEquals(response?.status, 200, "a discovered HEAD route must match");
      assertEquals(response?.body, null, "a HEAD response carries no body");
    });

    it("should support default handler", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/default/route.ts",
        'export async function default() { return Response.json({ method: "default" }); }',
      );
      __injectDepsForTests({
        loadHandlerModule: () =>
          Promise.resolve({
            default: () => Response.json({ method: "default" }),
          }),
      });

      const handler = await createInitializedHandler("/test/project", adapter);
      const response = await handler.handle(
        new Request("http://localhost/api/default"),
        localContext(adapter),
      );

      assertEquals(
        response?.status,
        200,
        "a discovered route must fall back to its default export",
      );
      assertEquals(
        await response?.json(),
        { method: "default" },
        "the default export must serve a method it does not export",
      );
    });
  });

  describe("constructor behavior", () => {
    it("should accept project directory and adapter", () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);

      assertExists(handler);
    });

    it("should work with only project directory", () => {
      const handler = createHandler("/test/project");

      assertExists(handler);
    });

    it("should handle empty project directory", () => {
      const adapter = createMockAdapter();
      const handler = createHandler("", adapter);

      assertExists(handler);
    });
  });

  // A load failure belongs to the attempt that produced it. Held on the
  // instance, it outlived the request and the next route to fail for its own
  // reason reported someone else's error.
  describe("load failure scoping", () => {
    async function handlerWithTwoRoutes(
      onLoad: (modulePath: string) => Promise<APIRoute | null>,
    ): Promise<{ handler: APIRouteHandler; localCtx: HandlerContext }> {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/broken.ts",
        "export function GET() { return new Response('broken'); }",
      );
      adapter.fs.files.set(
        "/test/project/pages/api/empty.ts",
        "export const notAMethod = 1;",
      );

      __injectDepsForTests({
        loadHandlerModule: ({ modulePath }) => onLoad(modulePath),
        prepareHandlerModule: async ({ modulePath }) => {
          const route = await onLoad(modulePath);
          if (!route || Object.keys(route).length === 0) {
            throw new Error("Handler not found");
          }
          const source = "export function GET() { return new Response('prepared'); }";
          const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(source),
          );
          return { source, sha256: bytesToHex(new Uint8Array(digest)) };
        },
      });

      return {
        handler: await createInitializedHandler("/test/project", adapter),
        localCtx: {
          projectDir: "/test/project",
          adapter,
          securityConfig: null,
          isLocalProject: true,
        },
      };
    }

    it("does not report one route's load error on another route", async () => {
      const { handler, localCtx } = await handlerWithTwoRoutes((modulePath) => {
        if (modulePath.includes("broken")) throw new Error("Unexpected token in broken.ts");
        // A module with no HTTP exports: no error, just nothing to call.
        return Promise.resolve({});
      });

      const broken = await handler.handle(new Request("http://localhost/api/broken"), localCtx);
      assertEquals(broken?.status, 500);
      assertEquals(await broken?.text(), "Unexpected token in broken.ts");

      const empty = await handler.handle(new Request("http://localhost/api/empty"), localCtx);
      assertEquals(empty?.status, 500);
      assertEquals(await empty?.text(), "Handler not found");
    });

    // The load error names files, specifiers and build internals. It is a
    // development aid, and the only thing keeping it out of a deployed response
    // body is this flag.
    it("withholds the load error from a response when the project is not local", async () => {
      const { handler, localCtx } = await handlerWithTwoRoutes((modulePath) => {
        if (modulePath.includes("broken")) {
          throw new Error("Unexpected token in /srv/releases/17/pages/api/broken.ts");
        }
        return Promise.resolve({});
      });

      const hosted = await handler.handle(
        new Request("http://localhost/api/broken"),
        { ...localCtx, isLocalProject: false },
      );

      assertEquals(hosted?.status, 500);
      assertEquals(await hosted?.text(), "Handler not found");
    });

    it("withholds the load error from a response when there is no context", async () => {
      const { handler } = await handlerWithTwoRoutes((modulePath) => {
        if (modulePath.includes("broken")) {
          throw new Error("Unexpected token in /srv/releases/17/pages/api/broken.ts");
        }
        return Promise.resolve({});
      });

      const anonymous = await handler.handle(new Request("http://localhost/api/broken"));

      assertEquals(anonymous?.status, 500);
      assertEquals(await anonymous?.text(), "Handler not found");
    });

    it("classifies the allow-list block against the current attempt only", async () => {
      const { handler } = await handlerWithTwoRoutes((modulePath) => {
        if (modulePath.includes("broken")) {
          throw new Error("Remote import blocked by allow-list: evil.example.com");
        }
        return Promise.resolve({});
      });

      const blocked = await handler.handle(new Request("http://localhost/api/broken"));
      assertEquals(blocked?.status, 502);

      const empty = await handler.handle(new Request("http://localhost/api/empty"));
      assertEquals(empty?.status, 500, "a later route inherited the allow-list classification");
    });
  });

  // AGENTS.md forbids local absolute paths, home directories, temp directories
  // and full stack traces in user-facing output. A dev-mode 500 body is
  // user-facing, and a raw module load error carries all four.
  describe("sanitizeLoadErrorForResponse", () => {
    const projectDir = "/PROJECT_ROOT/app";

    it("keeps the actionable first line", () => {
      const result = sanitizeLoadErrorForResponse(
        'Expected ";" but found "}"\n    at file:///PROJECT_ROOT/app/api/users.ts:12:3',
        projectDir,
      );

      assertEquals(result, 'Expected ";" but found "}"');
    });

    it("drops the stack trace", () => {
      const result = sanitizeLoadErrorForResponse(
        "Boom\n    at load (file:///PROJECT_ROOT/app/x.ts:1:1)\n    at run (x.ts:2:2)",
        projectDir,
      );

      assertEquals(result.includes("    at "), false);
    });

    it("makes a path inside the project relative", () => {
      const result = sanitizeLoadErrorForResponse(
        "Module not found: file:///PROJECT_ROOT/app/api/users.ts",
        projectDir,
      );

      assertEquals(result, "Module not found: api/users.ts");
    });

    it("redacts a temp directory the bundle was written to", () => {
      const result = sanitizeLoadErrorForResponse(
        "Could not resolve /var/folders/kx/T/vf-bundle-1234/route.js",
        projectDir,
      );

      assertEquals(result.includes("/var/folders/"), false);
      assertEquals(result.includes("<PATH>"), true);
    });

    it("redacts a home directory", () => {
      for (const path of ["/Users/someone/code/x.ts", "/home/someone/code/x.ts"]) {
        const result = sanitizeLoadErrorForResponse(`Cannot find module ${path}`, projectDir);

        assertEquals(result.includes("someone"), false, `leaked a home directory: ${result}`);
        assertEquals(result.includes("<PATH>"), true);
      }
    });

    it("redacts a file:// URL outside the project", () => {
      const result = sanitizeLoadErrorForResponse(
        "Failed to load file:///tmp/vf-9f/route.js",
        projectDir,
      );

      assertEquals(result.includes("file://"), false);
    });

    it("truncates a very long message", () => {
      const result = sanitizeLoadErrorForResponse("x".repeat(1000), projectDir);
      assertEquals(result.length <= 303, true);
      assertEquals(result.endsWith("..."), true);
    });

    it("handles an empty message and a missing project directory", () => {
      assertEquals(sanitizeLoadErrorForResponse(""), "");
      assertEquals(sanitizeLoadErrorForResponse("Handler not found"), "Handler not found");
    });
  });
});
