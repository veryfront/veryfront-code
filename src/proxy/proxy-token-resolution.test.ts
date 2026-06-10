import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isMissingCustomDomainProjectError,
  resolveProxyRequestToken,
} from "./proxy-token-resolution.ts";

describe("proxy/proxy-token-resolution", () => {
  it("prefers signed internal control-plane tokens over preview user cookies", async () => {
    const tokenManagerCalls: unknown[] = [];
    const result = await resolveProxyRequestToken({
      req: new Request("https://example.com/channels/invoke", {
        headers: {
          cookie: "authToken=user-cookie-token",
          "x-token": "signed-control-plane-token",
        },
      }),
      url: new URL("https://example.com/channels/invoke"),
      scope: "preview",
      host: "example.com",
      projectSlug: "my-project",
      config: {
        apiClientId: "client",
        apiClientSecret: "secret",
        apiToken: "static-token",
      },
      tokenManager: {
        getToken(...args) {
          tokenManagerCalls.push(args);
          return Promise.resolve("oauth-token");
        },
      },
      signedInternalControlPlaneRequest: true,
      allowSignedInternalControlPlaneToken: true,
      tokenFetchErrorMessage: "Token fetch failed",
    });

    assertEquals(result.token, "signed-control-plane-token");
    assertEquals(result.userToken, "user-cookie-token");
    assertEquals(result.tokenFetchError, undefined);
    assertEquals(tokenManagerCalls, []);
  });

  it("returns custom-domain token fetch errors without logging expected misses as errors", async () => {
    const loggedErrors: string[] = [];
    const notFoundError = new Error(
      "OAuth token request failed: 400 - Project not found for domain",
    );

    const result = await resolveProxyRequestToken({
      req: new Request("https://custom.example/page"),
      url: new URL("https://custom.example/page"),
      scope: "production",
      host: "custom.example",
      projectSlug: undefined,
      config: {
        apiClientId: "client",
        apiClientSecret: "secret",
        apiToken: undefined,
      },
      tokenManager: {
        getToken() {
          return Promise.reject(notFoundError);
        },
      },
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: (message) => loggedErrors.push(message),
      },
      tokenFetchErrorMessage: "Token fetch failed",
    });

    assertEquals(result.token, undefined);
    assertEquals(result.tokenFetchError, notFoundError);
    assertEquals(isMissingCustomDomainProjectError(result.tokenFetchError), true);
    assertEquals(loggedErrors, []);
  });
});
