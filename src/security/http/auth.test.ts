import "#veryfront/schemas/_test-setup.ts";
import { markApplicationAuthAdmittedRequest } from "#veryfront/security/application-auth/oidc-runtime.ts";
import { markTrustedProxyApplicationAuthAdmittedRequest } from "#veryfront/security/application-auth/trusted-proxy.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import type { HandlerContext, SecurityConfig } from "#veryfront/types";
import { AuthHandler, isAuthGateEnabled } from "./auth.ts";

/**
 * Tests that the AuthHandler sanitizes the Basic auth realm value
 * to prevent CRLF/header injection via user-configured realm strings.
 */
describe("AuthHandler realm sanitization", () => {
  function createHandler(): AuthHandler {
    return new AuthHandler();
  }

  function createCtx(realm?: unknown): HandlerContext {
    const basic: Record<string, unknown> = { username: "admin", password: "secret" };
    if (realm !== undefined) basic.realm = realm;
    return {
      projectDir: "/tmp/auth-test",
      securityConfig: { auth: { basic } } as unknown as SecurityConfig,
      adapter: {
        env: { get: () => "" },
      } as unknown as HandlerContext["adapter"],
      isLocalProject: false,
    };
  }

  async function getWwwAuthenticate(handler: AuthHandler, realm?: unknown): Promise<string> {
    const ctx = createCtx(realm);
    const req = new Request("http://localhost/test");
    const result = await handler.handle(req, ctx);
    const response = result.response as Response;
    return response.headers.get("WWW-Authenticate") ?? "";
  }

  it("passes clean realm values through", async () => {
    const handler = createHandler();
    const header = await getWwwAuthenticate(handler, "My App");
    expect(header).toBe('Basic realm="My App"');
  });

  it("strips double quotes from realm", async () => {
    const handler = createHandler();
    const header = await getWwwAuthenticate(handler, 'break"out');
    expect(header).toBe('Basic realm="breakout"');
    expect(header).not.toContain('""');
  });

  it("strips backslashes from realm", async () => {
    const handler = createHandler();
    const header = await getWwwAuthenticate(handler, "back\\slash");
    expect(header).toBe('Basic realm="backslash"');
  });

  it("strips CRLF characters from realm", async () => {
    const handler = createHandler();
    const header = await getWwwAuthenticate(handler, "line\r\nX-Injected: true");
    expect(header).toBe('Basic realm="lineX-Injected: true"');
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
  });

  it("strips null bytes and other control characters from realm", async () => {
    const handler = createHandler();
    const header = await getWwwAuthenticate(handler, "null\x00byte\x01ctrl");
    expect(header).toBe('Basic realm="nullbytectrl"');
  });

  it("uses default realm when none is configured", async () => {
    const handler = createHandler();
    const header = await getWwwAuthenticate(handler);
    expect(header).toBe('Basic realm="Secure Area"');
  });

  it("coerces non-string realm values to string", async () => {
    const handler = createHandler();
    const header = await getWwwAuthenticate(handler, 12345);
    expect(header).toBe('Basic realm="12345"');
  });

  it("exempts CORS preflight from the credential gate", async () => {
    // The preflight exemption must stay: a browser sends no credentials on an
    // OPTIONS preflight, so gating it breaks CORS on every auth-protected site.
    const handler = createHandler();
    const result = await handler.handle(
      new Request("http://localhost/test", { method: "OPTIONS" }),
      createCtx(),
    );

    expect(result.continue).toBe(true);
    expect(result.response).toBeUndefined();
  });

  it("applies the credential gate when an OPTIONS route is executable", async () => {
    const handler = createHandler();
    const result = await handler.handleExplicitOptions(
      new Request("http://localhost/test", { method: "OPTIONS" }),
      createCtx(),
    );

    expect(result.continue).not.toBe(true);
    expect(result.response?.status).toBe(401);
    expect(result.response?.headers.get("WWW-Authenticate")).toBe('Basic realm="Secure Area"');
  });

  it("does not widen the method exemption past OPTIONS", async () => {
    const handler = createHandler();
    const result = await handler.handle(
      new Request("http://localhost/test", { method: "HEAD" }),
      createCtx(),
    );

    expect(result.continue).not.toBe(true);
    expect(result.response?.status).toBe(401);
    expect(result.response?.headers.get("WWW-Authenticate")).toBe('Basic realm="Secure Area"');
  });

  it("does not invoke conversion hooks on an invalid realm value", async () => {
    const handler = createHandler();
    let conversions = 0;
    const hostileRealm = {
      [Symbol.toPrimitive]() {
        conversions++;
        throw new Error("realm conversion must not run");
      },
    };

    const header = await getWwwAuthenticate(handler, hostileRealm);

    expect(header).toBe('Basic realm="Secure Area"');
    expect(conversions).toBe(0);
  });

  it("keeps the outer Basic challenge request-local during CORS re-entry", async () => {
    const handler = createHandler();
    const outerCtx = createCtx("Outer Realm");
    if (!outerCtx.securityConfig) throw new Error("test security config is required");

    outerCtx.securityConfig.cors = {
      origin: () => {
        void handler.handle(
          new Request("http://localhost/inner"),
          createCtx("Inner Realm"),
        );
        return true;
      },
    };

    const result = await handler.handle(
      new Request("http://localhost/outer", {
        headers: { origin: "https://client.example" },
      }),
      outerCtx,
    );

    expect(result.response?.headers.get("WWW-Authenticate")).toBe(
      'Basic realm="Outer Realm"',
    );
  });

  it("applies the resolved CORS and security policy to unauthorized responses", async () => {
    const handler = createHandler();
    const ctx = createCtx();
    if (!ctx.securityConfig) throw new Error("test security config is required");
    ctx.securityConfig.cors = {
      origin: "https://client.example",
      credentials: true,
    };
    const req = new Request("http://localhost/test", {
      headers: { origin: "https://client.example" },
    });

    const result = await handler.handle(req, ctx);
    const response = result.response as Response;

    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://client.example",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a Bearer challenge with the same hardened unauthorized response", async () => {
    const handler = createHandler();
    const ctx: HandlerContext = {
      projectDir: "/tmp/auth-test",
      securityConfig: {
        auth: { bearer: { token: "expected-token" } },
        cors: { origin: "https://client.example" },
      } as SecurityConfig,
      adapter: {
        env: { get: () => "" },
      } as unknown as HandlerContext["adapter"],
      isLocalProject: false,
    };
    const req = new Request("http://localhost/test", {
      headers: {
        authorization: "Bearer wrong-token",
        origin: "https://client.example",
      },
    });

    const result = await handler.handle(req, ctx);
    const response = result.response as Response;

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://client.example",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("fails closed when environment variables configure both auth modes", async () => {
    const handler = createHandler();
    const credentials: Record<string, string> = {
      VERYFRONT_BASIC_USER: "admin",
      VERYFRONT_BASIC_PASS: "secret",
      VERYFRONT_BEARER_TOKEN: "expected-token",
    };
    const ctx: HandlerContext = {
      projectDir: "/tmp/auth-test",
      securityConfig: null,
      adapter: {
        env: { get: (name: string) => credentials[name] },
      } as unknown as HandlerContext["adapter"],
      isLocalProject: false,
    };

    for (
      const authorization of [
        `Basic ${btoa("admin:secret")}`,
        "Bearer expected-token",
      ]
    ) {
      const result = await handler.handle(
        new Request("http://localhost/test", {
          headers: { authorization },
        }),
        ctx,
      );

      expect(result.continue).not.toBe(true);
      expect(result.response?.status).toBe(401);
      expect(result.response?.headers.get("WWW-Authenticate")).toBe(
        'Basic realm="Secure Area", Bearer',
      );
    }
  });

  it("fails closed for every partial, empty, or competing environment auth state", async () => {
    const handler = createHandler();
    const values = [undefined, "", "configured"] as const;
    const basicAuthorization = `Basic ${btoa("configured:configured")}`;
    const bearerAuthorization = "Bearer configured";

    for (const username of values) {
      for (const password of values) {
        for (const token of values) {
          const credentials: Readonly<Record<string, string | undefined>> = {
            VERYFRONT_BASIC_USER: username,
            VERYFRONT_BASIC_PASS: password,
            VERYFRONT_BEARER_TOKEN: token,
          };
          const ctx: HandlerContext = {
            projectDir: "/tmp/auth-test",
            securityConfig: null,
            adapter: {
              env: { get: (name: string) => credentials[name] },
            } as unknown as HandlerContext["adapter"],
            isLocalProject: false,
          };
          const authDisabled = username === undefined &&
            password === undefined &&
            token === undefined;
          const validBasic = username === "configured" &&
            password === "configured" &&
            token === undefined;
          const validBearer = username === undefined &&
            password === undefined &&
            token === "configured";

          if (authDisabled) {
            const result = await handler.handle(
              new Request("http://localhost/test"),
              ctx,
            );
            expect(result.continue).toBe(true);
            continue;
          }

          if (validBasic || validBearer) {
            const result = await handler.handle(
              new Request("http://localhost/test", {
                headers: {
                  authorization: validBasic ? basicAuthorization : bearerAuthorization,
                },
              }),
              ctx,
            );
            expect(result.continue).toBe(true);
            continue;
          }

          for (
            const authorization of [
              undefined,
              basicAuthorization,
              bearerAuthorization,
            ]
          ) {
            const headers = authorization === undefined ? undefined : { authorization };
            const result = await handler.handle(
              new Request("http://localhost/test", { headers }),
              ctx,
            );
            const response = result.response as Response;

            expect(result.continue).not.toBe(true);
            expect(response.status).toBe(401);
            expect(response.headers.get("WWW-Authenticate")).toBe(
              'Basic realm="Secure Area", Bearer',
            );
            expect(await response.text()).toBe("Unauthorized");
          }
        }
      }
    }
  });

  it("does not expose an authentication bypass through test globals", async () => {
    const globals = globalThis as Record<string, unknown>;
    const hadFlag = Object.hasOwn(globals, "__vfTestEnv");
    const previousFlag = globals.__vfTestEnv;
    globals.__vfTestEnv = true;
    try {
      const ctx: HandlerContext = {
        projectDir: "/tmp/auth-test",
        securityConfig: null,
        adapter: {
          env: {
            get: (name: string) => name === "VERYFRONT_BEARER_TOKEN" ? "required" : undefined,
          },
        } as unknown as HandlerContext["adapter"],
        isLocalProject: false,
      };

      const result = await new AuthHandler().handle(
        new Request("http://localhost/test"),
        ctx,
      );

      expect(result.response?.status).toBe(401);
    } finally {
      if (hadFlag) globals.__vfTestEnv = previousFlag;
      else delete globals.__vfTestEnv;
    }
  });

  it("rejects accessor-backed explicit auth without invoking accessors", async () => {
    let getterCalls = 0;
    const auth = Object.defineProperty({}, "bearer", {
      enumerable: true,
      get() {
        getterCalls++;
        return { token: "must-not-be-trusted" };
      },
    });
    const securityConfig = Object.defineProperty({}, "auth", {
      enumerable: true,
      value: auth,
    }) as SecurityConfig;
    const ctx: HandlerContext = {
      projectDir: "/tmp/auth-test",
      securityConfig,
      adapter: {
        env: { get: () => undefined },
      } as unknown as HandlerContext["adapter"],
      isLocalProject: false,
    };

    const result = await new AuthHandler().handle(
      new Request("http://localhost/test", {
        headers: { authorization: "Bearer must-not-be-trusted" },
      }),
      ctx,
    );

    expect(result.response?.status).toBe(401);
    expect(getterCalls).toBe(0);
  });

  it("rejects an accessor-backed security auth field without invoking it", async () => {
    let getterCalls = 0;
    const securityConfig = Object.defineProperty({}, "auth", {
      enumerable: true,
      get() {
        getterCalls++;
        return { bearer: { token: "must-not-be-trusted" } };
      },
    }) as SecurityConfig;
    const ctx: HandlerContext = {
      projectDir: "/tmp/auth-test",
      securityConfig,
      adapter: {
        env: { get: () => undefined },
      } as unknown as HandlerContext["adapter"],
      isLocalProject: false,
    };

    const result = await new AuthHandler().handle(
      new Request("http://localhost/test", {
        headers: { authorization: "Bearer must-not-be-trusted" },
      }),
      ctx,
    );

    expect(result.response?.status).toBe(401);
    expect(getterCalls).toBe(0);
  });

  it("fails closed when explicit auth proxy inspection fails", async () => {
    const auth = new Proxy({}, {
      ownKeys() {
        throw new Error("hostile proxy");
      },
    });
    const ctx: HandlerContext = {
      projectDir: "/tmp/auth-test",
      securityConfig: { auth } as unknown as SecurityConfig,
      adapter: {
        env: { get: () => undefined },
      } as unknown as HandlerContext["adapter"],
      isLocalProject: false,
    };

    const result = await new AuthHandler().handle(
      new Request("http://localhost/test"),
      ctx,
    );

    expect(result.response?.status).toBe(401);
  });

  it("rejects malformed or competing explicit auth config without exposing credentials", async () => {
    const handler = createHandler();
    const invalidAuthConfigs: readonly unknown[] = [
      {},
      { basic: {} },
      { basic: { username: "admin" } },
      { basic: { password: "secret" } },
      { basic: { username: "", password: "secret" } },
      { basic: { username: "admin", password: "" } },
      { bearer: {} },
      { bearer: { token: "" } },
      {
        basic: { username: "admin", password: "secret" },
        bearer: { token: "private-token" },
      },
      { basic: undefined },
      { unknownMode: { secret: "must-not-leak" } },
      "invalid-auth-config",
    ];

    for (const auth of invalidAuthConfigs) {
      const ctx: HandlerContext = {
        projectDir: "/tmp/auth-test",
        securityConfig: { auth } as unknown as SecurityConfig,
        adapter: {
          env: { get: () => undefined },
        } as unknown as HandlerContext["adapter"],
        isLocalProject: false,
      };
      const result = await handler.handle(
        new Request("http://localhost/test", {
          headers: { authorization: "Bearer private-token" },
        }),
        ctx,
      );
      const response = result.response as Response;
      const body = await response.text();

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe(
        'Basic realm="Secure Area", Bearer',
      );
      expect(body).toBe("Unauthorized");
      expect(body).not.toContain("admin");
      expect(body).not.toContain("secret");
      expect(body).not.toContain("private-token");
    }
  });

  it("ignores explicit undefined sibling auth modes while resolving the defined mode", async () => {
    const handler = createHandler();

    const basic = await handler.handle(
      new Request("http://localhost/test", {
        headers: { authorization: `Basic ${btoa("admin:secret")}` },
      }),
      {
        projectDir: "/tmp/auth-test",
        securityConfig: {
          auth: {
            basic: { username: "admin", password: "secret" },
            bearer: undefined,
            oidc: undefined,
            trustedProxy: undefined,
          },
        } as unknown as SecurityConfig,
        adapter: {
          env: { get: () => undefined },
        } as unknown as HandlerContext["adapter"],
        isLocalProject: false,
      },
    );
    expect(basic.continue).toBe(true);

    const bearer = await handler.handle(
      new Request("http://localhost/test", {
        headers: { authorization: "Bearer project-token" },
      }),
      {
        projectDir: "/tmp/auth-test",
        securityConfig: {
          auth: {
            basic: undefined,
            bearer: { token: "project-token" },
            oidc: undefined,
            trustedProxy: undefined,
          },
        } as unknown as SecurityConfig,
        adapter: {
          env: { get: () => undefined },
        } as unknown as HandlerContext["adapter"],
        isLocalProject: false,
      },
    );
    expect(bearer.continue).toBe(true);

    const oidcRequest = new Request("http://localhost/test");
    markApplicationAuthAdmittedRequest(oidcRequest);
    const oidc = await handler.handle(oidcRequest, {
      projectDir: "/tmp/auth-test",
      securityConfig: {
        auth: {
          basic: undefined,
          bearer: undefined,
          oidc: {},
          trustedProxy: undefined,
        },
      } as unknown as SecurityConfig,
      adapter: {
        env: { get: () => undefined },
      } as unknown as HandlerContext["adapter"],
      isLocalProject: false,
    });
    expect(oidc.continue).toBe(true);

    const trustedProxyRequest = new Request("http://localhost/test");
    markTrustedProxyApplicationAuthAdmittedRequest(trustedProxyRequest);
    const trustedProxy = await handler.handle(trustedProxyRequest, {
      projectDir: "/tmp/auth-test",
      securityConfig: {
        auth: {
          basic: undefined,
          bearer: undefined,
          oidc: undefined,
          trustedProxy: {},
        },
      } as unknown as SecurityConfig,
      adapter: {
        env: { get: () => undefined },
      } as unknown as HandlerContext["adapter"],
      isLocalProject: false,
    });
    expect(trustedProxy.continue).toBe(true);
  });
});

/**
 * Regression: a project that configures `security.auth` must still answer the
 * control plane's own dispatch.
 *
 * `AuthHandler` runs at priority 0 with an empty pattern list, and the registry
 * never consults `metadata.patterns` — it calls every handler in priority
 * order — so the gate sits in front of every control-plane surface. The
 * platform authorizes those calls with a signed operation envelope, not with a
 * project-authored Basic or Bearer credential it cannot know, so a configured
 * project answered its own run dispatch with 401.
 */
describe("AuthHandler signed control-plane dispatch", () => {
  const SIGNED = { "x-veryfront-control-plane-jws": "header.payload.signature" };

  const SURFACES = [
    { method: "POST", path: "/api/control-plane/agents/list" },
    { method: "POST", path: "/api/control-plane/runs/run_1/execute" },
    { method: "POST", path: "/api/control-plane/runs/run_1/stream" },
    { method: "POST", path: "/api/control-plane/runs/run_1/resume" },
    { method: "DELETE", path: "/api/control-plane/runs/run_1" },
  ] as const;

  const AUTH_CONFIGS: readonly unknown[] = [
    { basic: { username: "admin", password: "secret" } },
    { bearer: { token: "project-token" } },
  ];

  function createCtx(auth: unknown): HandlerContext {
    return {
      projectDir: "/tmp/auth-test",
      securityConfig: { auth } as unknown as SecurityConfig,
      adapter: {
        env: { get: () => undefined },
      } as unknown as HandlerContext["adapter"],
      isLocalProject: false,
    };
  }

  function createEnvCtx(credentials: Record<string, string>): HandlerContext {
    return {
      projectDir: "/tmp/auth-test",
      securityConfig: null,
      adapter: {
        env: { get: (name: string) => credentials[name] },
      } as unknown as HandlerContext["adapter"],
      isLocalProject: false,
    };
  }

  it("passes every registered surface through for every configured auth shape", async () => {
    const handler = new AuthHandler();

    for (const auth of AUTH_CONFIGS) {
      for (const surface of SURFACES) {
        const result = await handler.handle(
          new Request(`https://acme.example.test${surface.path}`, {
            method: surface.method,
            headers: SIGNED,
          }),
          createCtx(auth),
        );

        expect(
          [surface.method, surface.path, result.response?.status ?? "continue"],
        ).toEqual([surface.method, surface.path, "continue"]);
      }
    }
  });

  it("passes a registered surface through for env-configured auth", async () => {
    // `VERYFRONT_BASIC_USER`/`VERYFRONT_BEARER_TOKEN` reach the same gate as the
    // config shape, so the deploy breaks identically when they are set.
    const handler = new AuthHandler();

    const credentialShapes: Record<string, string>[] = [
      { VERYFRONT_BASIC_USER: "admin", VERYFRONT_BASIC_PASS: "secret" },
      { VERYFRONT_BEARER_TOKEN: "project-token" },
    ];

    for (const credentials of credentialShapes) {
      const result = await handler.handle(
        new Request("https://acme.example.test/api/control-plane/runs/run_1/execute", {
          method: "POST",
          headers: SIGNED,
        }),
        createEnvCtx(credentials),
      );

      expect(result.response).toBe(undefined);
    }
  });

  it("still challenges a path that merely starts alike", async () => {
    const handler = new AuthHandler();

    const result = await handler.handle(
      new Request("https://acme.example.test/api/control-plane-mirror/runs/run_1/execute", {
        method: "POST",
        headers: SIGNED,
      }),
      createCtx({ basic: { username: "admin", password: "secret" } }),
    );

    expect(result.response?.status).toBe(401);
  });

  it("still challenges a project route inside the control-plane namespace", async () => {
    // The reserved namespace is not exclusively routed: only five method/path
    // shapes reach a handler that verifies a signed envelope, and anything else
    // falls through to `ApiHandlerWrapper` and runs project code. Exempting the
    // prefix would let a project turn its own auth gate off by choosing a path.
    const handler = new AuthHandler();
    const projectRoutes = [
      { method: "POST", path: "/api/control-plane/checkout" },
      { method: "POST", path: "/api/control-plane/runs" },
      { method: "POST", path: "/api/control-plane/runs/run_1" },
      { method: "POST", path: "/api/control-plane/runs/run_1/execute/extra" },
      { method: "POST", path: "/api/control-plane/agents/list/all" },
      { method: "PUT", path: "/api/control-plane/runs/run_1/execute" },
      { method: "DELETE", path: "/api/control-plane/runs/run_1/execute" },
      { method: "GET", path: "/api/control-plane/runs/run_1/execute" },
    ];

    for (const route of projectRoutes) {
      const result = await handler.handle(
        new Request(`https://acme.example.test${route.path}`, {
          method: route.method,
          headers: SIGNED,
        }),
        createCtx({ basic: { username: "admin", password: "secret" } }),
      );

      expect(
        [route.method, route.path, result.response?.status ?? "continue"],
      ).toEqual([route.method, route.path, 401]);
    }
  });

  it("still challenges a registered surface with no signature header", async () => {
    // A caller with no envelope has nothing verified downstream, so the gate
    // must hold. This is what keeps the exemption from being a bypass.
    const handler = new AuthHandler();

    for (const surface of SURFACES) {
      const result = await handler.handle(
        new Request(`https://acme.example.test${surface.path}`, {
          method: surface.method,
        }),
        createCtx({ basic: { username: "admin", password: "secret" } }),
      );

      expect(
        [surface.method, surface.path, result.response?.status ?? "continue"],
      ).toEqual([surface.method, surface.path, 401]);
    }
  });

  it("still challenges a registered surface with an empty signature header", async () => {
    const handler = new AuthHandler();

    const result = await handler.handle(
      new Request("https://acme.example.test/api/control-plane/runs/run_1/execute", {
        method: "POST",
        headers: { "x-veryfront-control-plane-jws": "" },
      }),
      createCtx({ basic: { username: "admin", password: "secret" } }),
    );

    expect(result.response?.status).toBe(401);
  });

  it("dispatches a signed surface even when the auth config is unresolvable", async () => {
    // An auth config the runtime cannot resolve fails closed for every browser
    // request, and that stays true — the two assertions below share one config.
    // A control-plane dispatch is not browser shaped: the receiving handler
    // verifies its envelope before acting, so a project typo must not brick the
    // platform's own run dispatch the way it must brick project content.
    const handler = new AuthHandler();
    const unresolvable = {
      basic: { username: "admin", password: "secret" },
      bearer: { token: "project-token" },
    };

    const dispatch = await handler.handle(
      new Request("https://acme.example.test/api/control-plane/runs/run_1/execute", {
        method: "POST",
        headers: SIGNED,
      }),
      createCtx(unresolvable),
    );
    expect(dispatch.response).toBe(undefined);

    const browser = await handler.handle(
      new Request("https://acme.example.test/api/control-plane/runs/run_1/execute", {
        method: "POST",
      }),
      createCtx(unresolvable),
    );
    expect(browser.response?.status).toBe(401);
  });
});

/**
 * `isAuthGateEnabled` exists so a handler emitting cache directives reads the
 * same gate `AuthHandler` enforces. Whether a shared cache may store a response
 * turns on this answer, so a disagreement between the two publishes protected
 * module source to a CDN.
 */
describe("isAuthGateEnabled", () => {
  function createGateCtx(
    securityConfig: unknown,
    env: Record<string, string> = {},
  ): HandlerContext {
    return {
      projectDir: "/tmp/auth-gate-test",
      securityConfig: securityConfig as SecurityConfig,
      adapter: {
        env: { get: (key: string) => env[key] },
      } as unknown as HandlerContext["adapter"],
      isLocalProject: false,
    };
  }

  it("reports no gate for a project that configures none", () => {
    expect(isAuthGateEnabled(createGateCtx(undefined))).toBe(false);
    expect(isAuthGateEnabled(createGateCtx({}))).toBe(false);
    expect(isAuthGateEnabled(createGateCtx({ cors: { origin: "*" } }))).toBe(false);
  });

  it("reports a gate for each configured credential kind", () => {
    expect(
      isAuthGateEnabled(createGateCtx({ auth: { basic: { username: "a", password: "b" } } })),
    ).toBe(true);
    expect(isAuthGateEnabled(createGateCtx({ auth: { bearer: { token: "t" } } }))).toBe(true);
    expect(isAuthGateEnabled(createGateCtx({ auth: { oidc: {} } }))).toBe(true);
    expect(isAuthGateEnabled(createGateCtx({ auth: { trustedProxy: {} } }))).toBe(true);
  });

  it("reports a gate for the environment credential fallbacks", () => {
    expect(
      isAuthGateEnabled(
        createGateCtx(undefined, { VERYFRONT_BASIC_USER: "a", VERYFRONT_BASIC_PASS: "b" }),
      ),
    ).toBe(true);
    expect(isAuthGateEnabled(createGateCtx(undefined, { VERYFRONT_BEARER_TOKEN: "t" }))).toBe(
      true,
    );
  });

  it("reports a gate for a config it cannot resolve", () => {
    // An unresolvable auth config 401s every browser request. A response nobody
    // may read must not be announced to shared caches as public either.
    expect(
      isAuthGateEnabled(createGateCtx({ auth: { basic: {}, bearer: { token: "t" } } })),
    ).toBe(true);
    expect(isAuthGateEnabled(createGateCtx({ auth: null }))).toBe(true);
    expect(isAuthGateEnabled(createGateCtx(Object.create({ auth: { oidc: {} } })))).toBe(true);
  });
});
