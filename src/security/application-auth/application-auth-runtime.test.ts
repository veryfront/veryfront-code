import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext, SecurityConfig } from "#veryfront/types";
import { HandlerPriority } from "#veryfront/types";
import { AuthHandler } from "#veryfront/security/http/auth.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import { handleApplicationAuthRequest } from "./application-auth-runtime.ts";
import { markApplicationAuthAdmittedRequest } from "./oidc-runtime.ts";

const APP_ORIGIN = "https://app.example.test";

function createCtx(envValues: Readonly<Record<string, string | undefined>> = {}): HandlerContext {
  return {
    projectDir: "/tmp/application-auth-runtime-test",
    securityConfig: {
      auth: {
        oidc: {
          issuerEnvVar: "OIDC_ISSUER",
          clientIdEnvVar: "OIDC_CLIENT_ID",
          clientSecretEnvVar: "OIDC_CLIENT_SECRET",
          sessionSecretEnvVar: "OIDC_SESSION_SECRET",
          scopes: ["openid"],
        },
      },
    } as SecurityConfig,
    adapter: {
      env: {
        get(name: string): string | undefined {
          return envValues[name];
        },
      },
    } as unknown as HandlerContext["adapter"],
    isLocalProject: false,
  };
}

function createTrustedProxyCtx(
  overrides: Partial<HandlerContext> = {},
): HandlerContext {
  return {
    projectDir: "/tmp/application-auth-runtime-test",
    securityConfig: {
      auth: {
        trustedProxy: {
          trustedPeers: ["127.0.0.1"],
          headers: {
            subject: "x-auth-subject",
            email: "x-auth-email",
            groups: "x-auth-groups",
          },
        },
      },
    } as SecurityConfig,
    adapter: {
      env: {
        get(_name: string): string | undefined {
          return undefined;
        },
      },
    } as unknown as HandlerContext["adapter"],
    isLocalProject: false,
    ...overrides,
  };
}

function trustedProxyRequest(): Request {
  const request = new Request(`${APP_ORIGIN}/dashboard`, {
    headers: {
      "x-auth-subject": "user-123",
      "x-auth-email": "user@example.test",
      "x-auth-groups": "admin, editor",
      authorization: "Bearer end-user",
    },
  });
  recordRequestPeerFromTransport(request, {
    runtime: "node",
    transport: "tcp",
    hostname: "127.0.0.1",
  });
  return request;
}

describe("security/application-auth runtime integration", () => {
  it("fails closed when OIDC is configured but the legacy auth handler runs without admission", async () => {
    const result = await new AuthHandler().handle(
      new Request(`${APP_ORIGIN}/dashboard`, { headers: { accept: "text/html" } }),
      createCtx(),
    );

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 401);
  });

  it("uses an unforgeable request marker to prevent duplicate legacy authentication", async () => {
    const request = new Request(`${APP_ORIGIN}/dashboard`, { headers: { accept: "text/html" } });
    markApplicationAuthAdmittedRequest(request);

    const result = await new AuthHandler().handle(request, createCtx());

    assertEquals(result.continue, true);
    assertEquals(result.response, undefined);
  });

  it("does not let a cloned OIDC-marked request bypass legacy authentication", async () => {
    const request = new Request(`${APP_ORIGIN}/dashboard`, { headers: { accept: "text/html" } });
    markApplicationAuthAdmittedRequest(request);

    const result = await new AuthHandler().handle(request.clone(), createCtx());

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 401);
  });

  it("redirects HTML requests to login when the OIDC wrapper finds no valid session", async () => {
    const result = await handleApplicationAuthRequest(
      new Request(`${APP_ORIGIN}/dashboard?view=home`, { headers: { accept: "text/html" } }),
      createCtx({
        APP_URL: APP_ORIGIN,
        OIDC_ISSUER: "https://issuer.example.test",
        OIDC_CLIENT_ID: "client-id",
        OIDC_CLIENT_SECRET: "client-secret",
        OIDC_SESSION_SECRET: "s".repeat(32),
      }),
    );

    assertEquals(result?.response?.status, 302);
    assertEquals(
      result?.response?.headers.get("Location"),
      "/_veryfront/auth/login?returnTo=%2Fdashboard%3Fview%3Dhome",
    );
    assertEquals(result?.response?.headers.get("Cache-Control"), "no-store");
  });

  it("admits trusted-proxy identity with normalized identity-header metadata", async () => {
    const result = await handleApplicationAuthRequest(
      trustedProxyRequest(),
      createTrustedProxyCtx(),
    );

    assertEquals(result?.continue, true);
    assertEquals(result?.metadata?.applicationIdentity, {
      issuer: "veryfront:trusted-proxy",
      subject: "user-123",
      email: "user@example.test",
      groups: ["admin", "editor"],
      roles: [],
      groupsComplete: true,
      claims: {
        sub: "user-123",
        email: "user@example.test",
        groups: ["admin", "editor"],
      },
    });
    assertEquals(result?.metadata?.applicationIdentityHeaderNames, [
      "x-auth-subject",
      "x-auth-email",
      "x-auth-groups",
    ]);
  });

  it("fails closed when trusted-proxy auth reaches the legacy handler without admission proof", async () => {
    const result = await new AuthHandler().handle(
      trustedProxyRequest(),
      createTrustedProxyCtx(),
    );

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 401);
    assertEquals(result.response?.headers.get("Cache-Control"), "no-store");
  });

  it("prevents unmarked trusted-proxy registry execution from reaching project code", async () => {
    let projectCodeReached = false;
    const registry = new RouteRegistry();
    registry.registerAll([
      new AuthHandler(),
      {
        metadata: {
          name: "ProjectCode",
          priority: HandlerPriority.LOW,
          patterns: [{ pattern: "/", prefix: true }],
        },
        handle: () => {
          projectCodeReached = true;
          return Promise.resolve({ response: new Response("project reached") });
        },
      },
    ]);

    const response = await registry.execute(trustedProxyRequest(), createTrustedProxyCtx());

    assertEquals(projectCodeReached, false);
    assertEquals(response?.status, 401);
  });

  it("marks the exact trusted-proxy request after successful application-auth admission", async () => {
    const request = trustedProxyRequest();
    const admission = await handleApplicationAuthRequest(request, createTrustedProxyCtx());

    assertEquals(admission?.continue, true);

    const result = await new AuthHandler().handle(request, createTrustedProxyCtx());

    assertEquals(result.continue, true);
    assertEquals(result.response, undefined);
  });

  it("does not let cloned or new trusted-proxy requests inherit application-auth proof", async () => {
    const request = trustedProxyRequest();
    const admission = await handleApplicationAuthRequest(request, createTrustedProxyCtx());

    assertEquals(admission?.continue, true);

    const clonedResult = await new AuthHandler().handle(request.clone(), createTrustedProxyCtx());
    const newRequestResult = await new AuthHandler().handle(
      new Request(request),
      createTrustedProxyCtx(),
    );

    assertEquals(clonedResult.continue, false);
    assertEquals(clonedResult.response?.status, 401);
    assertEquals(newRequestResult.continue, false);
    assertEquals(newRequestResult.response?.status, 401);
  });

  it("does not mark trusted-proxy requests after failed application-auth admission", async () => {
    const request = new Request(`${APP_ORIGIN}/dashboard`, {
      headers: {
        "x-auth-subject": "user-123",
      },
    });

    const admission = await handleApplicationAuthRequest(request, createTrustedProxyCtx());
    const result = await new AuthHandler().handle(request, createTrustedProxyCtx());

    assertEquals(admission?.response?.status, 401);
    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 401);
  });

  it("rejects trusted-proxy auth in hosted or proxy runtimes", async () => {
    const proxyMode = await handleApplicationAuthRequest(
      trustedProxyRequest(),
      createTrustedProxyCtx({ isProxyMode: true }),
    );
    const hostedConfig = await handleApplicationAuthRequest(
      trustedProxyRequest(),
      createTrustedProxyCtx({
        prepareHostedConfigContext: () => {
          throw new Error("must not prepare hosted config");
        },
      }),
    );

    assertEquals(proxyMode?.response?.status, 401);
    assertEquals(proxyMode?.response?.headers.get("Cache-Control"), "no-store");
    assertEquals(hostedConfig?.response?.status, 401);
    assertEquals(hostedConfig?.response?.headers.get("X-Content-Type-Options"), "nosniff");
  });
});
