import "#veryfront/schemas/_test-setup.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createVeryfrontHandler } from "#veryfront/server/runtime-handler/index.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
    middleware: {
      custom: [
        (context: { readonly identity: unknown }) => {
          const identity = context.identity;
          return Response.json({
            identity,
            rootFrozen: identity === null || typeof identity !== "object"
              ? null
              : Object.isFrozen(identity),
            claimsFrozen: identity === null || typeof identity !== "object" ||
                !("claims" in identity) || typeof identity.claims !== "object" ||
                identity.claims === null
              ? null
              : Object.isFrozen(identity.claims),
          });
        },
      ],
    },
  } as unknown as VeryfrontConfig;
  return createVeryfrontHandler("/tmp/application-auth-integration", createAdapter(values), {
    projectDir: "/tmp/application-auth-integration",
    config,
    allowHostProjectCodeExecution: true,
  });
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

    const api = await createHandler(environment)(
      new Request(`${APP_ORIGIN}/api/account`, { headers: { cookie: session } }),
    );
    assertEquals(api.status, 200);
    const apiBody = await api.json();
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
    assertEquals(apiBody.rootFrozen, true);
    assertEquals(apiBody.claimsFrozen, true);

    const page = await createHandler(environment)(
      new Request(`${APP_ORIGIN}/dashboard`, {
        headers: { accept: "text/html", cookie: session },
      }),
    );
    assertEquals(page.status, 200);
    assertEquals((await page.json()).identity, apiBody.identity);

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

    const cleared = await createHandler(environment)(new Request(`${APP_ORIGIN}/api/account`));
    assertEquals(cleared.status, 401);
    assertEquals(provider.getCallCounts(), {
      authorization: 2,
      discovery: 3,
      jwks: 1,
      token: 1,
      unexpected: 0,
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
          hasgroups: true,
          _claim_names: { groups: "src1" },
          _claim_sources: { src1: { endpoint: "https://graph.example.test/groups" } },
        },
        expected: {
          groups: ["bounded-group"],
          roles: ["Application.Reader"],
          groupsComplete: false,
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

      const admitted = await createHandler(environment)(
        new Request(`${APP_ORIGIN}/api/identity`, {
          headers: { cookie: sessionCookie(callback) },
        }),
      );
      assertEquals(admitted.status, 200);
      const identity = (await admitted.json()).identity;
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
      }

      provider.reset();
      provider.setFixture("token", { kind: "redirect" });
      const tokenLogin = await startLogin(provider, environment, "/token-redirect");
      const tokenRedirect = await finishLogin(provider, environment, tokenLogin, {
        claims: { sub: "token-redirect-subject" },
      });
      assertEquals(tokenRedirect.status, 400);
      assertEquals(tokenRedirect.headers.get("cache-control"), "no-store");
      assertEquals(tokenRedirect.headers.get("x-content-type-options"), "nosniff");

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

      const logSurface = JSON.stringify(records);
      assert(
        records.some((entry) =>
          entry.component === "request-tracker" &&
          entry.message.includes("/_veryfront/auth/login") &&
          entry.context?.statusCode === 500
        ),
      );
      assert(
        records.some((entry) =>
          entry.component === "request-tracker" &&
          entry.message.includes("/_veryfront/auth/callback") &&
          entry.context?.statusCode === 400
        ),
      );
      assertOmitsSensitive(logSurface, [
        CLIENT_SECRET,
        SESSION_SECRET,
        tokenLogin.state,
        tokenLogin.transaction,
        trustedOffOriginState,
        "token-redirect-subject",
        "off-origin-subject",
        "trusted-off-origin-subject",
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
