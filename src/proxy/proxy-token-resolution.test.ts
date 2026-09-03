import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  extractUserToken,
  isMissingProxyProjectError,
  resolveProxyRequestToken,
  stripUserTokenCookie,
} from "./proxy-token-resolution.ts";
import { OAuthTokenRequestError } from "./oauth-client.ts";

describe("proxy/proxy-token-resolution", () => {
  it("extracts one bounded visible auth cookie and rejects ambiguous or malformed values", () => {
    assertEquals(extractUserToken("other=x; authToken=user%2Dtoken"), "user-token");
    assertEquals(
      extractUserToken("authToken=first; authToken=second"),
      undefined,
    );
    assertEquals(extractUserToken("authToken=%E0%A4%A"), undefined);
    assertEquals(extractUserToken("authToken=token%0Avalue"), undefined);
    assertEquals(
      extractUserToken(`authToken=${"x".repeat(64 * 1024 + 1)}`),
      undefined,
    );
  });

  it("strips every authToken pair while preserving application cookies", () => {
    assertEquals(stripUserTokenCookie("authToken=secret"), undefined);
    assertEquals(stripUserTokenCookie("authToken=first; authToken=second"), undefined);
    assertEquals(
      stripUserTokenCookie("session=abc; authToken=secret; theme=dark"),
      "session=abc; theme=dark",
    );
    assertEquals(
      stripUserTokenCookie(" authToken = secret ; app=1"),
      "app=1",
    );
    assertEquals(stripUserTokenCookie("authToken; app=1"), "app=1");
    assertEquals(stripUserTokenCookie("authTokenX=1; XauthToken=2"), "authTokenX=1; XauthToken=2");
    assertEquals(stripUserTokenCookie(""), undefined);
  });

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

  it("can require service tokens for preview metadata while preserving the user token", async () => {
    const result = await resolveProxyRequestToken({
      req: new Request("https://my-project.preview.veryfront.com/page", {
        headers: { cookie: "authToken=user-cookie-token" },
      }),
      url: new URL("https://my-project.preview.veryfront.com/page"),
      scope: "preview",
      host: "my-project.preview.veryfront.com",
      projectSlug: "my-project",
      config: {
        apiClientId: "client",
        apiClientSecret: "secret",
        apiToken: "static-token",
      },
      tokenManager: {
        getToken() {
          return Promise.resolve("oauth-token");
        },
      },
      tokenStrategy: "service-first",
      tokenFetchErrorMessage: "Token fetch failed",
    });

    assertEquals(result.token, "oauth-token");
    assertEquals(result.userToken, "user-cookie-token");
    assertEquals(result.tokenSource, "service");
  });

  it("classifies both documented missing-project statuses", () => {
    assertEquals(
      isMissingProxyProjectError(new OAuthTokenRequestError(404, "{}")),
      true,
      "404 must classify as a missing project",
    );
    assertEquals(
      isMissingProxyProjectError(new OAuthTokenRequestError(400, "{}")),
      true,
      "400 remains the legacy missing-project status",
    );
    assertEquals(
      isMissingProxyProjectError(new OAuthTokenRequestError(500, "{}")),
      false,
      "an upstream outage must not be swallowed as a missing project",
    );
    assertEquals(
      isMissingProxyProjectError(new Error("boom")),
      false,
      "only typed OAuth errors classify",
    );
  });

  it("returns custom-domain token fetch errors without logging expected misses as errors", async () => {
    const loggedErrors: string[] = [];
    const notFoundError = new OAuthTokenRequestError(
      400,
      '{"error":"legacy custom-domain miss"}',
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
    assertEquals(isMissingProxyProjectError(result.tokenFetchError), true);
    assertEquals(loggedErrors, []);
  });

  it("passes the request signal to service-token waiters and propagates cancellation", async () => {
    const controller = new AbortController();
    const disconnected = new Error("client disconnected");
    const req = new Request("https://my-project.veryfront.com/page", {
      signal: controller.signal,
    });
    let waiterSignal: AbortSignal | undefined;

    const resolution = resolveProxyRequestToken({
      req,
      url: new URL(req.url),
      scope: "production",
      host: "my-project.veryfront.com",
      projectSlug: "my-project",
      config: {
        apiClientId: "client",
        apiClientSecret: "secret",
        apiToken: "must-not-mask-cancellation",
      },
      tokenManager: {
        getToken(_scope, _projectSlug, _customDomain, options) {
          waiterSignal = options?.signal;
          return new Promise((_resolve, reject) => {
            const onAbort = (): void => reject(waiterSignal?.reason);
            waiterSignal?.addEventListener("abort", onAbort, { once: true });
          });
        },
      },
      tokenFetchErrorMessage: "Token fetch failed",
    });

    controller.abort(disconnected);
    const error = await assertRejects(() => resolution, Error, disconnected.message);
    assertEquals(error, disconnected);
    assertEquals(waiterSignal, req.signal);
  });
});
