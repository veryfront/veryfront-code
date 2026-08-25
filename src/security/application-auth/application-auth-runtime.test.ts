import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext, SecurityConfig } from "#veryfront/types";
import { AuthHandler } from "#veryfront/security/http/auth.ts";
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
});
