import "#veryfront/schemas/_test-setup.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import {
  __injectDepsForTests as injectApiDepsForTests,
  type APIContext,
} from "#veryfront/routing/api/handler.ts";
import type { AppRouteContext } from "#veryfront/routing/api/module-loader/types.ts";
import { resetApiHandler } from "#veryfront/server/handlers/request/api/pages-api-handler.ts";
import {
  type RendererInitializer,
  setRendererInitializer,
} from "#veryfront/server/shared/renderer/index.ts";
import { createVeryfrontHandler } from "#veryfront/server/runtime-handler/index.ts";
import type { ApplicationIdentity } from "#veryfront/security/application-auth/types.ts";
import { __setCompiledBinaryForTests } from "#veryfront/security/sandbox/isolation-capability.ts";
import { __resetPoolForTests } from "#veryfront/security/sandbox/worker-pool.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Renderer } from "#veryfront/rendering/renderer.ts";
import {
  __resetLogRecordEmitterForTests,
  __subscribeLogRecordEmitter,
  type LogEntry,
} from "#veryfront/utils/logger/index.ts";
import { createMockOidcProvider, type MockOidcKeyName } from "./mock-oidc-provider.ts";
import { createOidcApplicationAuthRuntime } from "./oidc-runtime.ts";

const APP_ORIGIN = "https://app.example.test";
const CLIENT_ID = "application-client";
const CLIENT_SECRET = "application-client-secret";
const SESSION_SECRET = "s".repeat(32);
const NOW = 1_900_000_000;
const PROJECT_DIR = "/task-11-application-auth";
let composedRuntimeSequence = 0;

interface MiddlewareObservation {
  readonly pathname: string;
  readonly identity: ApplicationIdentity | null;
  readonly request: Request;
}

interface RendererObservation {
  readonly kind: "ssr" | "data" | "page-data" | "page-module";
  readonly pathname: string;
  readonly authorization: string | null;
  readonly cookie: string | null;
  readonly rawIdentityHeader: string | null;
}

interface ComposedIdentityHarness {
  readonly middleware: MiddlewareObservation[];
  readonly renderer: RendererObservation[];
  createRuntime(
    values: Readonly<Record<string, string | undefined>>,
    authOverride?: Readonly<Record<string, unknown>>,
  ): ReturnType<typeof createVeryfrontHandler>;
  enableWorkerIsolation(): Promise<void>;
}

function createAdapter(values: Readonly<Record<string, string | undefined>>): RuntimeAdapter {
  return {
    id: "memory",
    name: "application-auth-integration",
    capabilities: {},
    fs: {
      exists: () => Promise.resolve(false),
    },
    env: {
      get: (name: string) => values[name],
      set: () => {},
      delete: () => {},
      has: (name: string) => values[name] !== undefined,
      toObject: () =>
        Object.fromEntries(
          Object.entries(values).filter((entry): entry is [string, string] =>
            entry[1] !== undefined
          ),
        ),
    },
    server: {},
    serve: () => Promise.resolve({ close: () => Promise.resolve() }),
  } as unknown as RuntimeAdapter;
}

function oidcEnvironment(
  issuer: string,
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return {
    APP_URL: APP_ORIGIN,
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_CLIENT_SECRET: CLIENT_SECRET,
    OIDC_SESSION_SECRET: SESSION_SECRET,
    ...overrides,
  };
}

function createHandler(
  values: Readonly<Record<string, string | undefined>>,
  configOverrides: Readonly<Record<string, unknown>> = {},
) {
  const config = {
    security: {
      auth: {
        oidc: {
          issuerEnvVar: "OIDC_ISSUER",
          clientIdEnvVar: "OIDC_CLIENT_ID",
          clientSecretEnvVar: "OIDC_CLIENT_SECRET",
          sessionSecretEnvVar: "OIDC_SESSION_SECRET",
          scopes: ["openid", "profile", "email", "groups"],
          ...configOverrides,
        },
      },
    },
  } as unknown as VeryfrontConfig;
  return createVeryfrontHandler(PROJECT_DIR, createAdapter(values), {
    projectDir: PROJECT_DIR,
    config,
    allowHostProjectCodeExecution: true,
  });
}

function latestMiddlewareObservation(
  observations: readonly MiddlewareObservation[],
  pathname: string,
): MiddlewareObservation {
  const observation = observations.findLast((candidate) => candidate.pathname === pathname);
  assert(observation, `middleware did not observe ${pathname}`);
  return observation;
}

function identityBoundaryBody(
  boundary: "app-route" | "pages-api",
  identity: ApplicationIdentity | null,
  request: Request,
  observations: readonly MiddlewareObservation[],
): Record<string, unknown> {
  const middleware = latestMiddlewareObservation(observations, new URL(request.url).pathname);
  return {
    boundary,
    identity,
    equivalentIdentity: JSON.stringify(identity) === JSON.stringify(middleware.identity),
    detachedIdentity: identity !== middleware.identity,
    rootFrozen: identity === null ? null : Object.isFrozen(identity),
    claimsFrozen: identity === null ? null : Object.isFrozen(identity.claims),
    groupsFrozen: identity === null ? null : Object.isFrozen(identity.groups),
    rolesFrozen: identity === null ? null : Object.isFrozen(identity.roles),
    rootPrototypeNull: identity === null ? null : Object.getPrototypeOf(identity) === null,
    claimsPrototypeNull: identity === null ? null : Object.getPrototypeOf(identity.claims) === null,
    authorization: request.headers.get("authorization"),
    cookiePreserved: request.headers.has("cookie"),
    rawIdentityHeader: request.headers.get("x-veryfront-identity-subject"),
    configuredIdentityHeader: request.headers.get("x-auth-subject"),
  };
}

async function prepareWorkerModule(source: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return { source, sha256: new Uint8Array(digest).toHex() };
}

const WORKER_IDENTITY_ROUTE = [
  "let calls = 0;",
  "let previousIdentity = null;",
  "export function GET(request, context) {",
  "  calls += 1;",
  "  const identity = context.identity;",
  "  const sameAsPrevious = previousIdentity === identity;",
  "  previousIdentity = identity;",
  "  return Response.json({",
  '    boundary: "isolated-app-worker",',
  "    calls,",
  "    sameAsPrevious,",
  "    identity,",
  "    rootFrozen: identity === null ? null : Object.isFrozen(identity),",
  "    claimsFrozen: identity === null ? null : Object.isFrozen(identity.claims),",
  "    groupsFrozen: identity === null ? null : Object.isFrozen(identity.groups),",
  "    rolesFrozen: identity === null ? null : Object.isFrozen(identity.roles),",
  "    rootPrototypeNull: identity === null ? null : Object.getPrototypeOf(identity) === null,",
  "    claimsPrototypeNull: identity === null ? null : Object.getPrototypeOf(identity.claims) === null,",
  '    authorization: request.headers.get("authorization"),',
  '    cookiePreserved: request.headers.get("cookie")?.includes("__Host-vf_session=") ?? false,',
  '    rawIdentityHeader: request.headers.get("x-veryfront-identity-subject"),',
  "  });",
  "}",
].join("\n");

const WORKER_FAILURE_ROUTE =
  'export function GET() { throw new Error("representative worker failure"); }';

function createRendererInitializer(observations: RendererObservation[]): RendererInitializer {
  let initialized = false;
  const observe = (
    kind: RendererObservation["kind"],
    request: Request | undefined,
    fallbackPathname: string,
    pathnameOverride?: string,
  ) => {
    observations.push({
      kind,
      pathname: pathnameOverride ??
        (request === undefined ? fallbackPathname : new URL(request.url).pathname),
      authorization: request?.headers.get("authorization") ?? null,
      cookie: request?.headers.get("cookie") ?? null,
      rawIdentityHeader: request?.headers.get("x-veryfront-identity-subject") ?? null,
    });
  };
  const renderer = {
    renderPage(
      slug: string,
      _context: unknown,
      options?: { readonly request?: Request; readonly delivery?: "stream" | "string" },
    ) {
      const pathname = options?.request === undefined
        ? `/_veryfront/pages/${slug || "index"}.js`
        : options.delivery === undefined
        ? `/_veryfront/data/${slug || "index"}.json`
        : new URL(options.request.url).pathname;
      const kind = options?.request !== undefined && options.delivery === undefined
        ? "data"
        : pathname.startsWith("/_veryfront/pages/")
        ? "page-module"
        : "ssr";
      observe(kind, options?.request, pathname, pathname);
      return Promise.resolve({
        html: `<main data-task-11="${kind}">${slug || "index"}</main>`,
        frontmatter: { boundary: kind },
        headings: [],
        pageModule: {
          slug,
          code: `export default ${JSON.stringify(`task-11-${slug || "index"}`)};`,
          type: "component",
        },
        ssrHash: `task-11-${kind}`,
      });
    },
    resolvePageData(
      slug: string,
      _context: unknown,
      options?: { readonly request?: Request },
    ) {
      observe("page-data", options?.request, `/_veryfront/page-data/${slug}.json`);
      return Promise.resolve({
        slug,
        pagePath: "pages/dashboard.tsx",
        pageType: "tsx",
        layouts: [],
        providers: [],
        frontmatter: { boundary: "page-data" },
        props: {},
        params: {},
        layoutProps: {},
        buildVersion: { framework: "task-11", serverStart: 1 },
      });
    },
    getAllPages: () => Promise.resolve(["/dashboard"]),
    clearCache: () => Promise.resolve(),
    destroy: () => Promise.resolve(),
    initialize: () => Promise.resolve(),
  } as unknown as Renderer;

  return {
    initialize: () => {
      initialized = true;
      return Promise.resolve(renderer);
    },
    isInitialized: () => initialized,
    get: () => renderer,
    destroy: () => {
      initialized = false;
      return Promise.resolve();
    },
  };
}

async function withComposedIdentityHarness<T>(
  run: (harness: ComposedIdentityHarness) => Promise<T>,
): Promise<T> {
  const middleware: MiddlewareObservation[] = [];
  const renderer: RendererObservation[] = [];
  const projectDirs = new Set<string>();
  const priorWorkerEnabled = Deno.env.get("WORKER_ISOLATION_ENABLED");
  const priorWorkerApi = Deno.env.get("WORKER_ISOLATION_API");

  const workerModule = await prepareWorkerModule(WORKER_IDENTITY_ROUTE);
  const workerFailureModule = await prepareWorkerModule(WORKER_FAILURE_ROUTE);
  injectApiDepsForTests({
    getConfig: () => Promise.resolve({} as VeryfrontConfig),
    loadHandlerModule: ({ modulePath }) => {
      if (modulePath.endsWith("/app/api/app-identity/route.ts")) {
        return Promise.resolve({
          GET: (request: Request, context: AppRouteContext) =>
            Response.json(
              identityBoundaryBody(
                "app-route",
                context.identity,
                request,
                middleware,
              ),
            ),
        });
      }
      if (modulePath.endsWith("/pages/api/pages-identity.ts")) {
        return Promise.resolve({
          GET: (context: APIContext) =>
            Response.json(
              identityBoundaryBody(
                "pages-api",
                context.identity,
                context.request,
                middleware,
              ),
            ),
        });
      }
      return Promise.resolve(null);
    },
    prepareHandlerModule: ({ modulePath }) => {
      if (modulePath.endsWith("/app/api/worker-identity/route.ts")) {
        return Promise.resolve(workerModule);
      }
      assert(modulePath.endsWith("/app/api/worker-failure/route.ts"));
      return Promise.resolve(workerFailureModule);
    },
  });
  setRendererInitializer(createRendererInitializer(renderer));

  try {
    return await run({
      middleware,
      renderer,
      createRuntime(values, authOverride) {
        const projectDir = `${PROJECT_DIR}-${++composedRuntimeSequence}`;
        projectDirs.add(projectDir);
        const adapter = createMockAdapter();
        for (const [name, value] of Object.entries(values)) {
          if (value !== undefined) adapter.env.set(name, value);
        }
        adapter.fs.files.set(
          `${projectDir}/app/api/app-identity/route.ts`,
          "export function GET() { return new Response('injected'); }",
        );
        adapter.fs.files.set(
          `${projectDir}/pages/api/pages-identity.ts`,
          "export function GET() { return new Response('injected'); }",
        );
        adapter.fs.files.set(
          `${projectDir}/app/api/worker-identity/route.ts`,
          WORKER_IDENTITY_ROUTE,
        );
        adapter.fs.files.set(
          `${projectDir}/app/api/worker-failure/route.ts`,
          WORKER_FAILURE_ROUTE,
        );
        const config = {
          security: {
            auth: authOverride ?? {
              oidc: {
                issuerEnvVar: "OIDC_ISSUER",
                clientIdEnvVar: "OIDC_CLIENT_ID",
                clientSecretEnvVar: "OIDC_CLIENT_SECRET",
                sessionSecretEnvVar: "OIDC_SESSION_SECRET",
                scopes: ["openid", "profile", "email", "groups"],
              },
            },
          },
          middleware: {
            custom: [
              async (
                context: { readonly identity: ApplicationIdentity | null; readonly req: Request },
                next: () => Promise<Response>,
              ) => {
                middleware.push({
                  pathname: new URL(context.req.url).pathname,
                  identity: context.identity,
                  request: context.req,
                });
                return await next();
              },
            ],
          },
        } as unknown as VeryfrontConfig;
        return createVeryfrontHandler(projectDir, adapter, {
          projectDir,
          config,
          allowHostProjectCodeExecution: true,
        });
      },
      async enableWorkerIsolation() {
        Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
        Deno.env.set("WORKER_ISOLATION_API", "1");
        __setCompiledBinaryForTests(false);
        await __resetPoolForTests();
      },
    });
  } finally {
    try {
      for (const projectDir of projectDirs) await resetApiHandler(projectDir);
    } finally {
      injectApiDepsForTests(null);
      setRendererInitializer(undefined);
      __setCompiledBinaryForTests(undefined);
      if (priorWorkerEnabled === undefined) Deno.env.delete("WORKER_ISOLATION_ENABLED");
      else Deno.env.set("WORKER_ISOLATION_ENABLED", priorWorkerEnabled);
      if (priorWorkerApi === undefined) Deno.env.delete("WORKER_ISOLATION_API");
      else Deno.env.set("WORKER_ISOLATION_API", priorWorkerApi);
      await __resetPoolForTests();
    }
  }
}

function cookiePair(response: Response, name: string): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`(?:^|, )(${name}=[^;,]+)`).exec(setCookie);
  assert(match?.[1]);
  return match[1];
}

function transactionCookie(response: Response, state: string): string {
  return cookiePair(response, `__Host-vf_oidc_tx_${state}`);
}

function sessionCookie(response: Response): string {
  return cookiePair(response, "__Host-vf_session");
}

function clearingCookiePair(response: Response, name: string): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`(?:^|, )(${name}=[^;]*)`).exec(setCookie);
  assert(match?.[1]);
  return match[1];
}

async function publicFailureSurface(response: Response): Promise<string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of response.headers) headers[name] = value;
  return JSON.stringify({
    status: response.status,
    headers,
    body: await response.text(),
  });
}

function assertOmitsSensitive(surface: string, values: readonly string[]): void {
  for (const value of values) {
    if (value.length > 0) {
      assertEquals(surface.includes(value), false, `surface leaked ${value}`);
    }
  }
}

function assertTrackedFailure(
  records: readonly LogEntry[],
  startIndex: number,
  pathname: string,
  statusCode: number,
): void {
  assert(
    records.slice(startIndex).some((entry) =>
      entry.component === "request-tracker" &&
      entry.message.includes(pathname) &&
      entry.context?.statusCode === statusCode
    ),
    `repository logger did not record ${pathname} ${statusCode}`,
  );
}

async function startLogin(
  provider: Awaited<ReturnType<typeof createMockOidcProvider>>,
  environment: Readonly<Record<string, string | undefined>>,
  returnTo = "/",
): Promise<{
  readonly authorizationUrl: string;
  readonly state: string;
  readonly transaction: string;
}> {
  const response = await provider.run(() =>
    createHandler(environment)(
      new Request(
        `${APP_ORIGIN}/_veryfront/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
      ),
    )
  );
  assertEquals(response.status, 302);
  const authorizationUrl = response.headers.get("location");
  assert(authorizationUrl);
  const state = new URL(authorizationUrl).searchParams.get("state");
  assert(state);
  return {
    authorizationUrl,
    state,
    transaction: transactionCookie(response, state),
  };
}

async function finishLogin(
  provider: Awaited<ReturnType<typeof createMockOidcProvider>>,
  environment: Readonly<Record<string, string | undefined>>,
  login: Awaited<ReturnType<typeof startLogin>>,
  options: {
    readonly claims: Readonly<Record<string, unknown>>;
    readonly key?: MockOidcKeyName;
  },
): Promise<Response> {
  const callbackUrl = provider.authorize(login.authorizationUrl, options);
  return await provider.run(() =>
    createHandler(environment)(
      new Request(callbackUrl, { headers: { cookie: login.transaction } }),
    )
  );
}

function createDirectRuntime(
  environment: Readonly<Record<string, string | undefined>>,
) {
  return createOidcApplicationAuthRuntime({
    config: {
      issuerEnvVar: "OIDC_ISSUER",
      clientIdEnvVar: "OIDC_CLIENT_ID",
      clientSecretEnvVar: "OIDC_CLIENT_SECRET",
      sessionSecretEnvVar: "OIDC_SESSION_SECRET",
      scopes: ["openid", "profile", "email", "groups"],
    },
    env: { get: (name: string) => environment[name] },
    now: () => NOW,
  });
}

async function completeDirectCallback(
  runtime: ReturnType<typeof createDirectRuntime>,
  provider: Awaited<ReturnType<typeof createMockOidcProvider>>,
  key: MockOidcKeyName,
): Promise<Response> {
  const login = await provider.run(() =>
    runtime.handleAuthRoute(new Request(`${APP_ORIGIN}/_veryfront/auth/login`))
  );
  assert(login);
  const authorizationUrl = login.headers.get("location");
  assert(authorizationUrl);
  const state = new URL(authorizationUrl).searchParams.get("state");
  assert(state);
  const callbackUrl = provider.authorize(authorizationUrl, {
    key,
    claims: { sub: `subject-${key}` },
  });
  const callback = await provider.run(() =>
    runtime.handleAuthRoute(
      new Request(callbackUrl, { headers: { cookie: transactionCookie(login, state) } }),
    )
  );
  assert(callback);
  return callback;
}

describe("security/application-auth composed integration", () => {
  it("completes a horizontally portable Authelia-compatible flow across fresh handlers", async () => {
    const provider = await createMockOidcProvider({
      issuer: "https://auth.example.test",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      now: Math.floor(Date.now() / 1_000),
    });
    const environment = oidcEnvironment(provider.urls.issuer);

    const anonymousPage = await createHandler(environment)(
      new Request(`${APP_ORIGIN}/dashboard?tab=home`, {
        headers: { accept: "text/html" },
      }),
    );
    assertEquals(anonymousPage.status, 302);
    assertEquals(
      anonymousPage.headers.get("location"),
      "/_veryfront/auth/login?returnTo=%2Fdashboard%3Ftab%3Dhome",
    );

    const login = await startLogin(provider, environment, "/dashboard?tab=home");
    const callback = await finishLogin(provider, environment, login, {
      claims: {
        sub: "stable-subject",
        email: "person@example.test",
        name: "Example Person",
        groups: ["engineering", "operations"],
      },
    });
    const authorization = provider.getAuthorizationRequests()[0];
    assert(authorization);
    assertEquals(authorization.responseType, "code");
    assertEquals(authorization.codeChallengeMethod, "S256");
    assertEquals(authorization.clientId, CLIENT_ID);
    assertEquals(authorization.redirectUri, `${APP_ORIGIN}/_veryfront/auth/callback`);
    assertEquals(authorization.scope, "openid profile email groups");
    assertEquals(callback.status, 303);
    assertEquals(callback.headers.get("location"), "/dashboard?tab=home");
    const setCookie = callback.headers.get("set-cookie") ?? "";
    assertEquals(setCookie.includes(`__Host-vf_oidc_tx_${login.state}=;`), true);
    assertEquals(setCookie.includes("__Host-vf_session="), true);
    assertEquals(setCookie.includes("HttpOnly"), true);
    assertEquals(setCookie.includes("Secure"), true);
    const session = sessionCookie(callback);

    await withComposedIdentityHarness(async (harness) => {
      const api = await harness.createRuntime(environment)(
        new Request(`${APP_ORIGIN}/api/app-identity`, {
          headers: { cookie: session },
        }),
      );
      assertEquals(api.status, 200);
      const apiBody = await api.json();
      assertEquals(apiBody.boundary, "app-route");
      assertEquals(apiBody.identity.issuer, provider.urls.issuer);
      assertEquals(apiBody.identity.subject, "stable-subject");
      assertEquals(apiBody.identity.email, "person@example.test");
      assertEquals(apiBody.identity.name, "Example Person");
      assertEquals(apiBody.identity.groups, ["engineering", "operations"]);
      assertEquals(apiBody.identity.roles, []);
      assertEquals(apiBody.identity.groupsComplete, true);
      assertEquals(apiBody.identity.claims.iss, provider.urls.issuer);
      assertEquals(apiBody.identity.claims.sub, "stable-subject");
      assertEquals(apiBody.identity.claims.aud, CLIENT_ID);
      assertEquals(apiBody.identity.claims.nonce, authorization.nonce);
      assertEquals(typeof apiBody.identity.claims.iat, "number");
      assertEquals(apiBody.identity.claims.exp > apiBody.identity.claims.iat, true);
      assertEquals(apiBody.equivalentIdentity, true);
      assertEquals(apiBody.detachedIdentity, true);
      assertEquals(apiBody.rootFrozen, true);
      assertEquals(apiBody.claimsFrozen, true);

      const page = await harness.createRuntime(environment)(
        new Request(`${APP_ORIGIN}/dashboard`, {
          headers: { accept: "text/html", cookie: session },
        }),
      );
      assertEquals(page.status, 200);
      assert((await page.text()).includes('data-task-11="ssr"'));
      assertEquals(
        latestMiddlewareObservation(harness.middleware, "/dashboard").identity,
        apiBody.identity,
      );
      assertEquals(
        harness.renderer.some((entry) => entry.kind === "ssr" && entry.pathname === "/dashboard"),
        true,
      );
    });

    const mismatchedSecret = await createHandler(oidcEnvironment(provider.urls.issuer, {
      OIDC_SESSION_SECRET: "x".repeat(32),
    }))(
      new Request(`${APP_ORIGIN}/api/account`, { headers: { cookie: session } }),
    );
    assertEquals(mismatchedSecret.status, 401);
    assertEquals(await mismatchedSecret.text(), "Unauthorized");

    const driftLogin = await startLogin(provider, environment, "/drift-check");
    const tokenCallsBeforeDrift = provider.getCallCounts().token;
    const driftCallback = await finishLogin(
      provider,
      oidcEnvironment(provider.urls.issuer, { OIDC_CLIENT_ID: "different-client" }),
      driftLogin,
      { claims: { sub: "must-not-admit" } },
    );
    assertEquals(driftCallback.status, 400);
    assertEquals(provider.getCallCounts().token, tokenCallsBeforeDrift);
    const driftBody = await driftCallback.text();
    for (const secret of [CLIENT_SECRET, SESSION_SECRET, "must-not-admit"] as const) {
      assertEquals(driftBody.includes(secret), false);
      assertEquals((driftCallback.headers.get("set-cookie") ?? "").includes(secret), false);
    }

    const logout = await createHandler(environment)(
      new Request(`${APP_ORIGIN}/_veryfront/auth/logout`, {
        method: "POST",
        headers: { origin: APP_ORIGIN, cookie: session },
      }),
    );
    assertEquals(logout.status, 303);
    assertEquals(logout.headers.get("location"), "/");
    assertEquals(
      (logout.headers.get("set-cookie") ?? "").startsWith("__Host-vf_session=;"),
      true,
    );

    const cleared = await createHandler(environment)(
      new Request(`${APP_ORIGIN}/api/account`, {
        headers: { cookie: clearingCookiePair(logout, "__Host-vf_session") },
      }),
    );
    assertEquals(cleared.status, 401);
    assertEquals(provider.getCallCounts(), {
      authorization: 2,
      discovery: 3,
      jwks: 1,
      token: 1,
      unexpected: 0,
    });
  });

  it("carries OIDC identity through real middleware, route, renderer, and reused worker boundaries", async () => {
    const provider = await createMockOidcProvider({
      issuer: "https://identity-boundaries.example.test",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      now: Math.floor(Date.now() / 1_000),
    });
    const environment = oidcEnvironment(provider.urls.issuer);
    const loginA = await startLogin(provider, environment, "/identity-a");
    const callbackA = await finishLogin(provider, environment, loginA, {
      claims: {
        sub: "identity-a",
        email: "identity-a@example.test",
        groups: ["group-a"],
        roles: ["role-a"],
      },
    });
    assertEquals(callbackA.status, 303);
    const sessionA = sessionCookie(callbackA);

    const loginB = await startLogin(provider, environment, "/identity-b");
    const callbackB = await finishLogin(provider, environment, loginB, {
      claims: {
        sub: "identity-b",
        email: "identity-b@example.test",
        groups: ["group-b"],
        roles: ["role-b"],
      },
    });
    assertEquals(callbackB.status, 303);
    const sessionB = sessionCookie(callbackB);

    await withComposedIdentityHarness(async (harness) => {
      const runtime = harness.createRuntime(environment);
      const requestHeaders = (session: string) => ({
        authorization: "Bearer application-user-token",
        cookie: session,
        "x-veryfront-identity-subject": "forged-raw-identity",
      });

      const app = await runtime(
        new Request(`${APP_ORIGIN}/api/app-identity`, {
          headers: requestHeaders(sessionA),
        }),
      );
      assertEquals(app.status, 200);
      const appBody = await app.json();
      assertEquals(appBody.boundary, "app-route");
      assertEquals(appBody.identity.subject, "identity-a");
      assertEquals(appBody.equivalentIdentity, true);
      assertEquals(appBody.detachedIdentity, true);
      assertEquals(appBody.rootFrozen, true);
      assertEquals(appBody.claimsFrozen, true);
      assertEquals(appBody.groupsFrozen, true);
      assertEquals(appBody.rolesFrozen, true);
      assertEquals(appBody.rootPrototypeNull, true);
      assertEquals(appBody.claimsPrototypeNull, true);
      assertEquals(appBody.authorization, "Bearer application-user-token");
      assertEquals(appBody.cookiePreserved, true);
      assertEquals(appBody.rawIdentityHeader, null);
      const appMiddleware = latestMiddlewareObservation(
        harness.middleware,
        "/api/app-identity",
      );
      assert(appMiddleware.identity);
      assertEquals(Object.isFrozen(appMiddleware.identity), true);
      assertEquals(Object.isFrozen(appMiddleware.identity.claims), true);
      assertEquals(Object.isFrozen(appMiddleware.identity.groups), true);
      assertEquals(Object.isFrozen(appMiddleware.identity.roles), true);

      const pages = await runtime(
        new Request(`${APP_ORIGIN}/api/pages-identity`, {
          headers: requestHeaders(sessionA),
        }),
      );
      assertEquals(pages.status, 200);
      const pagesBody = await pages.json();
      assertEquals(pagesBody.boundary, "pages-api");
      assertEquals(pagesBody.identity, appBody.identity);
      assertEquals(pagesBody.equivalentIdentity, true);
      assertEquals(pagesBody.detachedIdentity, true);
      assertEquals(pagesBody.authorization, "Bearer application-user-token");
      assertEquals(pagesBody.cookiePreserved, true);
      assertEquals(pagesBody.rawIdentityHeader, null);

      const trustedProxyRuntime = harness.createRuntime({}, {
        trustedProxy: {
          trustedPeers: ["127.0.0.1"],
          headers: { subject: "x-auth-subject" },
        },
      });
      const trustedProxyRequest = new Request(`${APP_ORIGIN}/api/app-identity`, {
        headers: {
          authorization: "Bearer trusted-proxy-application-token",
          cookie: "application-cookie=preserved",
          "x-auth-subject": "trusted-proxy-subject",
        },
      });
      recordRequestPeerFromTransport(trustedProxyRequest, {
        runtime: "node",
        transport: "tcp",
        hostname: "127.0.0.1",
      });
      const trustedProxy = await trustedProxyRuntime(trustedProxyRequest);
      assertEquals(trustedProxy.status, 200);
      const trustedProxyBody = await trustedProxy.json();
      assertEquals(trustedProxyBody.identity.subject, "trusted-proxy-subject");
      assertEquals(trustedProxyBody.configuredIdentityHeader, null);
      assertEquals(
        trustedProxyBody.authorization,
        "Bearer trusted-proxy-application-token",
      );
      assertEquals(trustedProxyBody.cookiePreserved, true);
      const trustedProxyMiddleware = latestMiddlewareObservation(
        harness.middleware,
        "/api/app-identity",
      );
      assertEquals(trustedProxyMiddleware.request.headers.get("x-auth-subject"), null);
      assertEquals(
        trustedProxyMiddleware.request.headers.get("authorization"),
        "Bearer trusted-proxy-application-token",
      );
      assertEquals(
        trustedProxyMiddleware.request.headers.get("cookie"),
        "application-cookie=preserved",
      );

      const rendererPaths = [
        ["/dashboard", "ssr"],
        ["/_veryfront/data/dashboard.json", "data"],
        ["/_veryfront/page-data/dashboard.json", "page-data"],
        ["/_veryfront/pages/dashboard.js", "page-module"],
      ] as const;
      for (const [pathname, kind] of rendererPaths) {
        const response = await runtime(
          new Request(`${APP_ORIGIN}${pathname}`, {
            headers: requestHeaders(sessionA),
          }),
        );
        assertEquals(response.status, 200, `${pathname} must reach its real registry handler`);
        await response.arrayBuffer();
        const middleware = latestMiddlewareObservation(harness.middleware, pathname);
        assertEquals(middleware.identity, appBody.identity);
        assertEquals(
          middleware.request.headers.get("authorization"),
          "Bearer application-user-token",
        );
        assertEquals(middleware.request.headers.get("cookie"), sessionA);
        assertEquals(middleware.request.headers.get("x-veryfront-identity-subject"), null);
        const renderer = harness.renderer.findLast((entry) =>
          entry.kind === kind && entry.pathname === pathname
        );
        assert(renderer, `${pathname} must reach the ${kind} implementation`);
        if (kind === "page-module") {
          assertEquals(renderer.authorization, null);
          assertEquals(renderer.cookie, null);
          assertEquals(renderer.rawIdentityHeader, null);
        } else {
          assertEquals(renderer.authorization, "Bearer application-user-token");
          assertEquals(renderer.cookie, sessionA);
          assertEquals(renderer.rawIdentityHeader, null);
        }
      }

      await harness.enableWorkerIsolation();
      const workerA = await runtime(
        new Request(`${APP_ORIGIN}/api/worker-identity`, {
          headers: requestHeaders(sessionA),
        }),
      );
      assertEquals(workerA.status, 200);
      const workerABody = await workerA.json();
      assertEquals(workerABody.boundary, "isolated-app-worker");
      assertEquals(workerABody.calls, 1);
      assertEquals(workerABody.sameAsPrevious, false);
      assertEquals(workerABody.identity, appBody.identity);
      assertEquals(workerABody.rootFrozen, true);
      assertEquals(workerABody.claimsFrozen, true);
      assertEquals(workerABody.groupsFrozen, true);
      assertEquals(workerABody.rolesFrozen, true);
      assertEquals(workerABody.rootPrototypeNull, true);
      assertEquals(workerABody.claimsPrototypeNull, true);
      assertEquals(workerABody.authorization, "Bearer application-user-token");
      assertEquals(workerABody.cookiePreserved, true);
      assertEquals(workerABody.rawIdentityHeader, null);
      assert(
        workerABody.identity !==
          latestMiddlewareObservation(harness.middleware, "/api/worker-identity").identity,
        "the worker response must contain a detached identity value",
      );

      const middlewareCallsBeforeAnonymous = harness.middleware.length;
      const anonymous = await runtime(new Request(`${APP_ORIGIN}/api/worker-identity`));
      assertEquals(anonymous.status, 401);
      assertEquals(await anonymous.text(), "Unauthorized");
      assertEquals(
        harness.middleware.length,
        middlewareCallsBeforeAnonymous,
        "a rejected request must not inherit identity or enter project code",
      );

      const workerB = await runtime(
        new Request(`${APP_ORIGIN}/api/worker-identity`, {
          headers: requestHeaders(sessionB),
        }),
      );
      assertEquals(workerB.status, 200);
      const workerBBody = await workerB.json();
      assertEquals(workerBBody.calls, 2, "the same isolated module instance must be reused");
      assertEquals(workerBBody.sameAsPrevious, false);
      assertEquals(workerBBody.identity.subject, "identity-b");
      assertEquals(workerBBody.identity.groups, ["group-b"]);
      assertEquals(workerBBody.identity.roles, ["role-b"]);
      assertEquals(workerBBody.rootFrozen, true);
      assertEquals(workerBBody.claimsFrozen, true);
      assertEquals(
        latestMiddlewareObservation(harness.middleware, "/api/worker-identity").identity?.subject,
        "identity-b",
      );
    });
  });

  it("normalizes Microsoft Entra and generic AD FS-shaped providers through the same runtime", async () => {
    const fixtures = [
      {
        issuer: "https://login.microsoftonline.example.test/tenant/v2.0",
        subject: "entra-object-subject",
        claims: {
          sub: "entra-object-subject",
          email: "mutable-address@example.test",
          name: "Mutable Display Name",
          roles: ["Application.Reader"],
          groups: ["bounded-group"],
        },
        expected: {
          groups: ["bounded-group"],
          roles: ["Application.Reader"],
          groupsComplete: true,
        },
      },
      {
        issuer: "https://login.microsoftonline.example.test/tenant-with-overage/v2.0",
        subject: "entra-overage-subject",
        claims: {
          sub: "entra-overage-subject",
          preferred_username: "mutable-upn@example.test",
          hasgroups: true,
          _claim_names: { groups: "src1" },
          _claim_sources: { src1: { endpoint: "https://graph.example.test/groups" } },
        },
        expected: {
          groups: [],
          roles: [],
          groupsComplete: false,
        },
      },
      {
        issuer: "https://federation.example.test/adfs",
        subject: "adfs-subject",
        claims: {
          sub: "adfs-subject",
          email: "adfs-user@example.test",
          groups: ["directory-backed-group"],
        },
        expected: {
          groups: ["directory-backed-group"],
          roles: [],
          groupsComplete: true,
        },
      },
    ] as const;

    await withComposedIdentityHarness(async (harness) => {
      for (const fixture of fixtures) {
        const provider = await createMockOidcProvider({
          issuer: fixture.issuer,
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          now: Math.floor(Date.now() / 1_000),
        });
        const environment = oidcEnvironment(provider.urls.issuer);
        const login = await startLogin(provider, environment, "/provider-fixture");
        const callback = await finishLogin(provider, environment, login, {
          claims: fixture.claims,
        });
        assertEquals(callback.status, 303);

        const admitted = await harness.createRuntime(environment)(
          new Request(`${APP_ORIGIN}/api/app-identity`, {
            headers: { cookie: sessionCookie(callback) },
          }),
        );
        assertEquals(admitted.status, 200);
        const admittedBody = await admitted.json();
        assertEquals(admittedBody.boundary, "app-route");
        assertEquals(admittedBody.equivalentIdentity, true);
        assertEquals(admittedBody.detachedIdentity, true);
        const identity = admittedBody.identity;
        assertEquals(identity.issuer, fixture.issuer);
        assertEquals(identity.subject, fixture.subject);
        assertEquals(identity.groups, fixture.expected.groups);
        assertEquals(identity.roles, fixture.expected.roles);
        assertEquals(identity.groupsComplete, fixture.expected.groupsComplete);
        assertEquals(provider.urls.discovery, `${fixture.issuer}/.well-known/openid-configuration`);
        assertEquals(provider.getCallCounts().token, 1);
        assertEquals(provider.getCallCounts().jwks, 1);
      }
    });
  });

  it("keeps discovery and JWKS caches correctness-independent across rotation and cold runtimes", async () => {
    const provider = await createMockOidcProvider({
      issuer: "https://rotation.example.test",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      now: NOW,
    });
    const environment = oidcEnvironment(provider.urls.issuer);
    const warmRuntime = createDirectRuntime(environment);

    provider.publishKeys(["key-a"]);
    assertEquals((await completeDirectCallback(warmRuntime, provider, "key-a")).status, 303);
    assertEquals(provider.getCallCounts().jwks, 1);

    provider.publishKeys(["key-a", "key-b"]);
    assertEquals((await completeDirectCallback(warmRuntime, provider, "key-b")).status, 303);
    assertEquals(
      provider.getCallCounts().jwks,
      2,
      "a new kid must cause exactly one forced JWKS refresh",
    );

    assertEquals((await completeDirectCallback(warmRuntime, provider, "key-c")).status, 400);
    assertEquals(
      provider.getCallCounts().jwks,
      3,
      "an unpublished kid must cause one refresh and then fail",
    );

    provider.setKeyId("key-b", "key-a");
    provider.publishKeys(["key-b"]);
    assertEquals((await completeDirectCallback(warmRuntime, provider, "key-b")).status, 303);
    assertEquals(
      provider.getCallCounts().jwks,
      4,
      "same-kid replacement material must cause at most one signature refresh",
    );

    const coldRuntime = createDirectRuntime(environment);
    assertEquals((await completeDirectCallback(coldRuntime, provider, "key-b")).status, 303);
    assertEquals(provider.getCallCounts().jwks, 5);
    assertEquals(provider.getCallCounts().discovery, 2);
    assertEquals(provider.getCallCounts().token, 5);
  });

  it("binds callbacks to issuer, audience, azp, state, nonce, redirect, and one-time codes", async () => {
    const provider = await createMockOidcProvider({
      issuer: "https://binding.example.test",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      now: Math.floor(Date.now() / 1_000),
    });
    const environment = oidcEnvironment(provider.urls.issuer);

    const issuerLogin = await startLogin(provider, environment, "/issuer");
    const issuerCallbackUrl = new URL(provider.authorize(issuerLogin.authorizationUrl, {
      claims: { sub: "issuer-mixup" },
    }));
    issuerCallbackUrl.searchParams.set("iss", "https://other-issuer.example.test");
    const issuerMixup = await provider.run(() =>
      createHandler(environment)(
        new Request(issuerCallbackUrl.href, { headers: { cookie: issuerLogin.transaction } }),
      )
    );
    assertEquals(issuerMixup.status, 400);
    assertEquals(provider.getCallCounts().token, 0);

    const stateLogin = await startLogin(provider, environment, "/state");
    const stateCallbackUrl = new URL(provider.authorize(stateLogin.authorizationUrl, {
      claims: { sub: "state-mixup" },
    }));
    stateCallbackUrl.searchParams.set("state", "S".repeat(43));
    const stateMixup = await provider.run(() =>
      createHandler(environment)(
        new Request(stateCallbackUrl.href, { headers: { cookie: stateLogin.transaction } }),
      )
    );
    assertEquals(stateMixup.status, 400);
    assertEquals(provider.getCallCounts().token, 0);

    const nonceLogin = await startLogin(provider, environment, "/nonce");
    const nonceMismatch = await finishLogin(provider, environment, nonceLogin, {
      claims: { sub: "nonce-mixup", nonce: "N".repeat(43) },
    });
    assertEquals(nonceMismatch.status, 400);

    const audienceLogin = await startLogin(provider, environment, "/audience");
    const audienceMismatch = await finishLogin(provider, environment, audienceLogin, {
      claims: { sub: "audience-mixup", aud: "different-client" },
    });
    assertEquals(audienceMismatch.status, 400);

    const azpLogin = await startLogin(provider, environment, "/azp");
    const azpMismatch = await finishLogin(provider, environment, azpLogin, {
      claims: { sub: "azp-mixup", aud: [CLIENT_ID, "api://resource"], azp: "other-client" },
    });
    assertEquals(azpMismatch.status, 400);

    const redirectLogin = await startLogin(provider, environment, "/redirect");
    const redirectMismatch = await finishLogin(
      provider,
      oidcEnvironment(provider.urls.issuer, { APP_URL: "https://different-app.example.test" }),
      redirectLogin,
      { claims: { sub: "redirect-mixup" } },
    );
    assertEquals(redirectMismatch.status, 500);

    const firstParallel = await startLogin(provider, environment, "/parallel-a");
    const secondParallel = await startLogin(provider, environment, "/parallel-b");
    const firstCallback = await finishLogin(provider, environment, firstParallel, {
      claims: { sub: "parallel-a" },
    });
    assertEquals(firstCallback.status, 303);
    const secondCallback = await finishLogin(provider, environment, secondParallel, {
      claims: { sub: "parallel-b" },
    });
    assertEquals(secondCallback.status, 303);
    assertEquals(secondCallback.headers.get("location"), "/parallel-b");

    const replayLogin = await startLogin(provider, environment, "/replay");
    const replayCallbackUrl = provider.authorize(replayLogin.authorizationUrl, {
      claims: { sub: "replay" },
    });
    const firstReplay = await provider.run(() =>
      createHandler(environment)(
        new Request(replayCallbackUrl, { headers: { cookie: replayLogin.transaction } }),
      )
    );
    assertEquals(firstReplay.status, 303);
    const replayed = await provider.run(() =>
      createHandler(environment)(
        new Request(replayCallbackUrl, { headers: { cookie: replayLogin.transaction } }),
      )
    );
    assertEquals(replayed.status, 400);

    const surface = [
      await publicFailureSurface(issuerMixup),
      await publicFailureSurface(stateMixup),
      await publicFailureSurface(nonceMismatch),
      await publicFailureSurface(audienceMismatch),
      await publicFailureSurface(azpMismatch),
      await publicFailureSurface(redirectMismatch),
      await publicFailureSurface(replayed),
    ].join("\n");
    assertOmitsSensitive(surface, [
      CLIENT_SECRET,
      SESSION_SECRET,
      issuerLogin.transaction,
      stateLogin.transaction,
      nonceLogin.transaction,
      audienceLogin.transaction,
      azpLogin.transaction,
      redirectLogin.transaction,
      replayLogin.transaction,
      "issuer-mixup",
      "state-mixup",
      "nonce-mixup",
      "audience-mixup",
      "azp-mixup",
      "redirect-mixup",
      "replay",
    ]);
  });

  it("retains composed parser, network, endpoint-origin, and log redaction defenses", async () => {
    const provider = await createMockOidcProvider({
      issuer: "https://parser.example.test",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      now: Math.floor(Date.now() / 1_000),
    });
    const environment = oidcEnvironment(provider.urls.issuer);
    const records: LogEntry[] = [];
    __resetLogRecordEmitterForTests();
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    try {
      for (
        const fixture of [
          { kind: "redirect" },
          { kind: "wrong-content-type" },
          { kind: "oversized-body", bytes: 700 * 1024 },
          { kind: "slow-body", delayMs: 6_000 },
        ] as const
      ) {
        provider.reset();
        provider.setFixture("discovery", fixture);
        const recordStart = records.length;
        const login = await provider.run(() =>
          createHandler(environment)(new Request(`${APP_ORIGIN}/_veryfront/auth/login`))
        );
        assertEquals(login.status, 500);
        assertEquals(login.headers.get("cache-control"), "no-store");
        assertEquals(login.headers.get("x-content-type-options"), "nosniff");
        assertOmitsSensitive(await publicFailureSurface(login), [
          CLIENT_SECRET,
          SESSION_SECRET,
          fixture.kind,
          provider.urls.discovery,
        ]);
        assertTrackedFailure(records, recordStart, "/_veryfront/auth/login", 500);
      }

      provider.reset();
      provider.setFixture("token", { kind: "redirect" });
      const tokenLogin = await startLogin(provider, environment, "/token-redirect");
      const tokenAuthorization = provider.parseAuthorizationRedirect(tokenLogin.authorizationUrl);
      const tokenCallbackUrl = provider.authorize(tokenLogin.authorizationUrl, {
        claims: { sub: "token-redirect-subject" },
      });
      const tokenCode = new URL(tokenCallbackUrl).searchParams.get("code");
      assert(tokenCode);
      const tokenRecordStart = records.length;
      const tokenRedirect = await provider.run(() =>
        createHandler(environment)(
          new Request(tokenCallbackUrl, { headers: { cookie: tokenLogin.transaction } }),
        )
      );
      assertEquals(tokenRedirect.status, 400);
      assertEquals(tokenRedirect.headers.get("cache-control"), "no-store");
      assertEquals(tokenRedirect.headers.get("x-content-type-options"), "nosniff");
      assertTrackedFailure(records, tokenRecordStart, "/_veryfront/auth/callback", 400);

      provider.reset();
      const verifierLogin = await startLogin(provider, environment, "/verifier-failure");
      const verifierAuthorization = provider.parseAuthorizationRedirect(
        verifierLogin.authorizationUrl,
      );
      const verifierCallbackUrl = provider.authorize(verifierLogin.authorizationUrl, {
        claims: {
          sub: "verifier-private-subject",
          email: "verifier-private@example.test",
          groups: ["verifier-private-group"],
          roles: ["verifier-private-role"],
          nonce: "verifier-hostile-nonce",
        },
      });
      const verifierCode = new URL(verifierCallbackUrl).searchParams.get("code");
      assert(verifierCode);
      const verifierRecordStart = records.length;
      const verifierFailure = await provider.run(() =>
        createHandler(environment)(
          new Request(verifierCallbackUrl, {
            headers: { cookie: verifierLogin.transaction },
          }),
        )
      );
      assertEquals(verifierFailure.status, 400);
      assertTrackedFailure(records, verifierRecordStart, "/_veryfront/auth/callback", 400);

      const cookieValue = "hostile-cookie-value";
      const cookieRecordStart = records.length;
      const cookieFailure = await createHandler(environment)(
        new Request(`${APP_ORIGIN}/api/cookie-failure`, {
          headers: { cookie: `__Host-vf_session=${cookieValue}` },
        }),
      );
      assertEquals(cookieFailure.status, 401);
      assertTrackedFailure(records, cookieRecordStart, "/api/cookie-failure", 401);

      const callbackState = "h".repeat(43);
      const callbackCode = "hostile-callback-code";
      const callbackVerifier = "hostile-pkce-verifier";
      const callbackChallenge = "hostile-pkce-challenge";
      const callbackNonce = "hostile-callback-nonce";
      const hostileProviderBody = "malformed-hostile-provider-body";
      const callbackIdToken = await provider.issueIdToken({
        nonce: callbackNonce,
        claims: { sub: "hostile-token-subject" },
      });
      const callbackFailureUrl = new URL(`${APP_ORIGIN}/_veryfront/auth/callback`);
      callbackFailureUrl.searchParams.set("state", callbackState);
      callbackFailureUrl.searchParams.set("code", callbackCode);
      callbackFailureUrl.searchParams.set("code_verifier", callbackVerifier);
      callbackFailureUrl.searchParams.set("code_challenge", callbackChallenge);
      callbackFailureUrl.searchParams.set("nonce", callbackNonce);
      callbackFailureUrl.searchParams.set("id_token", callbackIdToken);
      callbackFailureUrl.searchParams.set("provider_response", hostileProviderBody);
      const callbackRecordStart = records.length;
      const callbackFailure = await provider.run(() =>
        createHandler(environment)(
          new Request(callbackFailureUrl, {
            headers: {
              cookie: `__Host-vf_oidc_tx_${callbackState}=hostile-decrypted-transaction`,
            },
          }),
        )
      );
      assertEquals(callbackFailure.status, 400);
      assertTrackedFailure(records, callbackRecordStart, "/_veryfront/auth/callback", 400);

      const privateEnvironment = {
        PRIVATE_ACCOUNT_ID: "private-account-4827",
        PRIVATE_TENANT_ID: "private-tenant-9134",
        PRIVATE_INTERNAL_HOST: "internal-auth.private.example.test",
        PRIVATE_LOCAL_PATH: "/local/absolute/path/<REDACTED>",
      } as const;
      const environmentRecordStart = records.length;
      const environmentFailure = await provider.run(() =>
        createHandler(oidcEnvironment(provider.urls.issuer, {
          ...privateEnvironment,
          OIDC_SESSION_SECRET: undefined,
        }))(new Request(`${APP_ORIGIN}/_veryfront/auth/login`))
      );
      assertEquals(environmentFailure.status, 500);
      assertTrackedFailure(records, environmentRecordStart, "/_veryfront/auth/login", 500);

      const offOriginProvider = await createMockOidcProvider({
        issuer: "https://off-origin.example.test",
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        tokenUrl: "https://tokens.example.test/token",
        now: Math.floor(Date.now() / 1_000),
      });
      const offOriginEnvironment = oidcEnvironment(offOriginProvider.urls.issuer);
      const offOriginLogin = await offOriginProvider.run(() =>
        createHandler(offOriginEnvironment)(
          new Request(`${APP_ORIGIN}/_veryfront/auth/login?returnTo=%2Foff-origin`),
        )
      );
      assertEquals(offOriginLogin.status, 500);
      assertEquals(offOriginProvider.getCallCounts().token, 0);

      const trustedOriginConfig = {
        trustedEndpointOrigins: ["https://tokens.example.test"],
      };
      const trustedOffOriginLogin = await offOriginProvider.run(() =>
        createHandler(offOriginEnvironment, trustedOriginConfig)(
          new Request(`${APP_ORIGIN}/_veryfront/auth/login?returnTo=%2Ftrusted-off-origin`),
        )
      );
      assertEquals(trustedOffOriginLogin.status, 302);
      const trustedOffOriginLocation = trustedOffOriginLogin.headers.get("location");
      assert(trustedOffOriginLocation);
      const trustedOffOriginState = new URL(trustedOffOriginLocation).searchParams.get("state");
      assert(trustedOffOriginState);
      const trustedOffOriginCallbackUrl = offOriginProvider.authorize(trustedOffOriginLocation, {
        claims: { sub: "trusted-off-origin-subject" },
      });
      const trustedOffOriginCallback = await offOriginProvider.run(() =>
        createHandler(offOriginEnvironment, trustedOriginConfig)(
          new Request(trustedOffOriginCallbackUrl, {
            headers: {
              cookie: transactionCookie(trustedOffOriginLogin, trustedOffOriginState),
            },
          }),
        )
      );
      assertEquals(trustedOffOriginCallback.status, 303);

      provider.reset();
      const workerLogin = await startLogin(provider, environment, "/worker-failure");
      const workerCallback = await finishLogin(provider, environment, workerLogin, {
        claims: {
          sub: "worker-private-subject",
          email: "worker-private@example.test",
          name: "Worker Private Profile",
          groups: ["worker-private-group"],
          roles: ["worker-private-role"],
        },
      });
      assertEquals(workerCallback.status, 303);
      const workerSession = sessionCookie(workerCallback);
      await withComposedIdentityHarness(async (harness) => {
        await harness.enableWorkerIsolation();
        const workerRecordStart = records.length;
        const workerFailure = await harness.createRuntime(
          oidcEnvironment(provider.urls.issuer, privateEnvironment),
        )(
          new Request(`${APP_ORIGIN}/api/worker-failure`, {
            headers: {
              authorization: "Bearer worker-private-authorization",
              cookie: workerSession,
              "x-veryfront-identity-subject": "worker-forged-identity",
            },
          }),
        );
        assertEquals(workerFailure.status, 500);
        assertTrackedFailure(records, workerRecordStart, "/api/worker-failure", 500);
        assert(
          records.slice(workerRecordStart).some((entry) =>
            entry.level === "error" &&
            entry.message.includes("API route error in /api/worker-failure (worker)")
          ),
          "repository logger did not record the isolated worker failure boundary",
        );
        assertOmitsSensitive(await publicFailureSurface(workerFailure), [
          CLIENT_SECRET,
          SESSION_SECRET,
          workerSession,
          "worker-private-subject",
          "worker-private@example.test",
          "worker-private-group",
          "worker-private-role",
          ...Object.values(privateEnvironment),
        ]);
      });

      const logSurface = JSON.stringify(records);
      assertOmitsSensitive(logSurface, [
        CLIENT_SECRET,
        SESSION_SECRET,
        tokenCode,
        tokenAuthorization.codeChallenge,
        tokenAuthorization.nonce,
        tokenLogin.state,
        tokenLogin.transaction,
        verifierCode,
        verifierAuthorization.codeChallenge,
        verifierAuthorization.nonce,
        verifierLogin.state,
        verifierLogin.transaction,
        callbackCode,
        callbackVerifier,
        callbackChallenge,
        callbackState,
        callbackNonce,
        callbackIdToken,
        cookieValue,
        "hostile-decrypted-transaction",
        hostileProviderBody,
        trustedOffOriginState,
        workerLogin.state,
        workerLogin.transaction,
        workerSession,
        "token-redirect-subject",
        "verifier-private-subject",
        "verifier-private@example.test",
        "verifier-private-group",
        "verifier-private-role",
        "hostile-token-subject",
        "off-origin-subject",
        "trusted-off-origin-subject",
        "worker-private-subject",
        "worker-private@example.test",
        "Worker Private Profile",
        "worker-private-group",
        "worker-private-role",
        "Bearer worker-private-authorization",
        "worker-forged-identity",
        ...Object.values(privateEnvironment),
      ]);
    } finally {
      unsubscribe();
      __resetLogRecordEmitterForTests();
    }
  });

  it("fails tenant, cookie, endpoint, and provider-body boundaries closed without reflection", async () => {
    const tenantA = await createMockOidcProvider({
      issuer: "https://tenant-a.example.test",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      now: Math.floor(Date.now() / 1_000),
    });
    const tenantB = await createMockOidcProvider({
      issuer: "https://tenant-b.example.test",
      clientId: "tenant-b-client",
      clientSecret: "tenant-b-client-secret",
      now: Math.floor(Date.now() / 1_000),
    });
    const environmentA = oidcEnvironment(tenantA.urls.issuer);
    const environmentB = oidcEnvironment(tenantB.urls.issuer, {
      OIDC_CLIENT_ID: "tenant-b-client",
      OIDC_CLIENT_SECRET: "tenant-b-client-secret",
      OIDC_SESSION_SECRET: "b".repeat(32),
    });
    const loginA = await startLogin(tenantA, environmentA, "/tenant-a");

    const crossTenantCallback = await finishLogin(tenantA, environmentB, loginA, {
      claims: { sub: "tenant-a-subject", email: "private@example.test" },
    });
    assertEquals(crossTenantCallback.status, 400);
    assertEquals(tenantA.getCallCounts().token, 0);

    const validCallback = await finishLogin(tenantA, environmentA, loginA, {
      claims: { sub: "tenant-a-subject", email: "private@example.test" },
    });
    assertEquals(validCallback.status, 303);
    const tenantASession = sessionCookie(validCallback);
    const crossTenantSession = await createHandler(environmentB)(
      new Request(`${APP_ORIGIN}/api/identity`, { headers: { cookie: tenantASession } }),
    );
    assertEquals(crossTenantSession.status, 401);

    tenantB.setFixture("discovery", { kind: "duplicate-json-keys" });
    const hostileDiscovery = await tenantB.run(() =>
      createHandler(environmentB)(new Request(`${APP_ORIGIN}/_veryfront/auth/login`))
    );
    assertEquals(hostileDiscovery.status, 500);
    const publicFailure = [
      await hostileDiscovery.text(),
      hostileDiscovery.headers.get("location") ?? "",
      hostileDiscovery.headers.get("set-cookie") ?? "",
    ].join("\n");
    for (
      const forbidden of [
        "tenant-b-client-secret",
        "private@example.test",
        loginA.state,
        loginA.transaction,
        "duplicate",
      ]
    ) {
      assertEquals(publicFailure.includes(forbidden), false);
    }
    assertEquals(hostileDiscovery.headers.get("x-content-type-options"), "nosniff");
    assertEquals(hostileDiscovery.headers.get("cache-control"), "no-store");
  });
});
