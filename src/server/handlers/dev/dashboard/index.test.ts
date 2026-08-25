import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../../types.ts";
import { DevDashboardHandler } from "./index.ts";
import {
  DASHBOARD_CSRF_HEADER_NAME,
  DASHBOARD_CSRF_META_NAME,
  DASHBOARD_SESSION_PATH,
  getDashboardSessionCookieName,
} from "#veryfront/extensions/dev-ui/protocol";
import { createDevUiAssetProvider } from "#veryfront/extensions/dev-ui";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";

const DEV_UI_BUNDLE = "globalThis.__veryfrontDevUiTest = true;";
const DEV_UI_PROVIDER = createDevUiAssetProvider(DEV_UI_BUNDLE);

function localContext(): HandlerContext {
  return {
    projectDir: "/project",
    securityConfig: null,
    isLocalProject: true,
  } as HandlerContext;
}

function dashboardRequest(url: string, headers: HeadersInit = {}): Request {
  const parsed = new URL(url);
  const finalHeaders = new Headers(headers);
  if (!finalHeaders.has("host")) finalHeaders.set("host", parsed.host);
  return requestFromPeer(new Request(parsed, { headers: finalHeaders }));
}

function requestFromPeer<T extends Request>(request: T, hostname = "127.0.0.1"): T {
  recordRequestPeerFromTransport(request, {
    runtime: "node",
    transport: "tcp",
    hostname,
  });
  return request;
}

describe("DevDashboardHandler admission", () => {
  it("rejects DNS-rebinding hosts across shell, UI, and API paths", async () => {
    const handler = new DevDashboardHandler();
    for (const path of ["/_dev", "/_dev/ui/index.js", "/_dev/api/stats"]) {
      const result = await handler.handle(
        dashboardRequest(`http://evil.attacker:8000${path}`),
        localContext(),
      );
      assertEquals(result.response?.status, 403, path);
    }
  });

  it("rejects cross-site browser work across shell, UI, and API paths", async () => {
    const handler = new DevDashboardHandler();
    for (const path of ["/_dev", "/_dev/ui/index.js", "/_dev/api/stats"]) {
      const result = await handler.handle(
        dashboardRequest(`http://localhost${path}`, { "sec-fetch-site": "cross-site" }),
        localContext(),
      );
      assertEquals(result.response?.status, 403, path);
    }
  });

  it("does not mint a session for a forged local Host from a non-loopback peer", async () => {
    const handler = new DevDashboardHandler();
    const request = requestFromPeer(
      new Request(`http://localhost:3002${DASHBOARD_SESSION_PATH}`, {
        headers: { host: "localhost:3002" },
      }),
      "192.168.1.25",
    );

    const response = (await handler.handle(request, localContext())).response!;

    assertEquals(response.status, 403);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(response.headers.has("set-cookie"), false);
  });

  it("does not await a hostile body cancellation before denying access", async () => {
    let cancelled = false;
    const cancellationNeverSettles = new Promise<void>(() => {});
    const request = requestFromPeer(
      new Request(
        "http://localhost/_dev/api/hmr-trigger",
        {
          method: "POST",
          headers: { host: "localhost" },
          body: new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
              return cancellationNeverSettles;
            },
          }),
          duplex: "half",
        } as RequestInit & { duplex: "half" },
      ),
      "203.0.113.8",
    );

    const response = (await new DevDashboardHandler().handle(
      request,
      localContext(),
    )).response!;

    assertEquals(response.status, 403);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(cancelled, true);
  });

  it("rejects shell mutation methods without awaiting body cancellation", async () => {
    let cancelled = false;
    const cancellationNeverSettles = new Promise<void>(() => {});
    const request = requestFromPeer(
      new Request(
        "http://localhost/_dev",
        {
          method: "POST",
          headers: { host: "localhost" },
          body: new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
              return cancellationNeverSettles;
            },
          }),
          duplex: "half",
        } as RequestInit & { duplex: "half" },
      ),
    );

    const response = (await new DevDashboardHandler(DEV_UI_PROVIDER).handle(
      request,
      localContext(),
    )).response!;

    assertEquals(response.status, 405);
    assertEquals(response.headers.get("allow"), "GET, HEAD");
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(cancelled, true);
  });

  it("issues a no-store shell with its session cookie and matching token metadata", async () => {
    const result = await new DevDashboardHandler(DEV_UI_PROVIDER).handle(
      dashboardRequest("http://localhost/_dev"),
      localContext(),
    );
    const response = result.response!;
    const html = await response.text();

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("cache-control"), "no-store");
    const cookie = response.headers.get("set-cookie") ?? "";
    assertStringIncludes(cookie, `${getDashboardSessionCookieName(80)}=`);
    assertStringIncludes(cookie, "HttpOnly");
    assertStringIncludes(cookie, "SameSite=Strict");
    const cookiePair = cookie.split(";", 1)[0] ?? "";
    const separator = cookiePair.indexOf("=");
    const token = separator === -1 ? "" : cookiePair.slice(separator + 1);
    assertStringIncludes(
      html,
      `<meta name="${DASHBOARD_CSRF_META_NAME}" content="${token}">`,
    );

    const headResponse = (await new DevDashboardHandler(DEV_UI_PROVIDER).handle(
      requestFromPeer(
        new Request("http://localhost/_dev", {
          method: "HEAD",
          headers: { host: "localhost" },
        }),
      ),
      localContext(),
    )).response!;
    assertEquals(headResponse.status, response.status);
    assertEquals(
      headResponse.headers.get("content-type"),
      response.headers.get("content-type"),
    );
    assertEquals(await headResponse.text(), "");
  });

  it("issues a headless session without requiring optional Dev UI assets", async () => {
    const handler = new DevDashboardHandler();
    const response = (await handler.handle(
      dashboardRequest(`http://localhost:3002${DASHBOARD_SESSION_PATH}`),
      localContext(),
    )).response!;

    assertEquals(response.status, 204);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertStringIncludes(
      response.headers.get("set-cookie") ?? "",
      `${getDashboardSessionCookieName(3002)}=`,
    );
    assertEquals(await response.text(), "");

    let cancelled = false;
    const cancellationNeverSettles = new Promise<void>(() => {});
    const rejectedMethod = (await handler.handle(
      requestFromPeer(
        new Request(
          `http://localhost:3002${DASHBOARD_SESSION_PATH}`,
          {
            method: "POST",
            headers: { host: "localhost:3002" },
            body: new ReadableStream<Uint8Array>({
              cancel() {
                cancelled = true;
                return cancellationNeverSettles;
              },
            }),
            duplex: "half",
          } as RequestInit & { duplex: "half" },
        ),
      ),
      localContext(),
    )).response!;
    assertEquals(rejectedMethod.status, 405);
    assertEquals(rejectedMethod.headers.get("allow"), "GET, HEAD");
    assertEquals(cancelled, true);
  });

  it("enforces the dashboard mutation session on POST API routes", async () => {
    const handler = new DevDashboardHandler(DEV_UI_PROVIDER);
    const missingSession = (await handler.handle(
      requestFromPeer(
        new Request("http://localhost/_dev/api/hmr-trigger", {
          method: "POST",
          headers: { host: "localhost" },
          body: "{}",
        }),
      ),
      localContext(),
    )).response!;

    assertEquals(missingSession.status, 403);

    const sessionResponse = (await handler.handle(
      dashboardRequest(`http://localhost${DASHBOARD_SESSION_PATH}`),
      localContext(),
    )).response!;
    const cookie = sessionResponse.headers.get("set-cookie") ?? "";
    const cookiePair = cookie.split(";", 1)[0] ?? "";
    const token = cookiePair.slice(cookiePair.indexOf("=") + 1);

    const validSession = (await handler.handle(
      requestFromPeer(
        new Request("http://localhost/_dev/api/hmr-trigger", {
          method: "POST",
          headers: {
            host: "localhost",
            cookie: cookiePair,
            [DASHBOARD_CSRF_HEADER_NAME]: token,
          },
          body: "{}",
        }),
      ),
      localContext(),
    )).response!;

    assertEquals(validSession.status, 200);
  });

  it("requires the mutation session for every non-read API method", async () => {
    const handler = new DevDashboardHandler(DEV_UI_PROVIDER);

    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = (await handler.handle(
        requestFromPeer(
          new Request("http://localhost/_dev/api/hmr-trigger", {
            method,
            headers: { host: "localhost" },
            ...(method === "OPTIONS" ? {} : { body: "{}" }),
          }),
        ),
        localContext(),
      )).response!;

      assertEquals(response.status, 403, method);
      assertEquals(response.headers.get("cache-control"), "no-store", method);
    }

    const sessionResponse = (await handler.handle(
      dashboardRequest(`http://localhost${DASHBOARD_SESSION_PATH}`),
      localContext(),
    )).response!;
    const cookiePair = (sessionResponse.headers.get("set-cookie") ?? "").split(";", 1)[0] ?? "";
    const token = cookiePair.slice(cookiePair.indexOf("=") + 1);

    // With a valid session, unrouted mutation methods fall through to the
    // API router's 404 rather than being rejected by the session gate.
    const unroutedMethod = (await handler.handle(
      requestFromPeer(
        new Request("http://localhost/_dev/api/hmr-trigger", {
          method: "PUT",
          headers: {
            host: "localhost",
            cookie: cookiePair,
            [DASHBOARD_CSRF_HEADER_NAME]: token,
          },
          body: "{}",
        }),
      ),
      localContext(),
    )).response!;
    assertEquals(unroutedMethod.status, 404);

    // Reads remain admitted without the mutation session.
    const readWithoutSession = (await handler.handle(
      dashboardRequest("http://localhost/_dev/api/stats"),
      localContext(),
    )).response!;
    assertEquals(readWithoutSession.status, 200);
  });

  it("serves only the captured local bundle and fails closed without it", async () => {
    const handler = new DevDashboardHandler(DEV_UI_PROVIDER);
    const getResponse = (await handler.handle(
      dashboardRequest("http://localhost/_dev/ui/index.js"),
      localContext(),
    )).response!;
    assertEquals(getResponse.status, 200);
    assertEquals(await getResponse.text(), DEV_UI_BUNDLE);
    assertEquals(getResponse.headers.get("x-content-type-options"), "nosniff");

    const headResponse = (await handler.handle(
      requestFromPeer(
        new Request("http://localhost/_dev/ui/index.js", {
          method: "HEAD",
          headers: { host: "localhost" },
        }),
      ),
      localContext(),
    )).response!;
    assertEquals(headResponse.status, 200);
    assertEquals(await headResponse.text(), "");

    let cancelled = false;
    const cancellationNeverSettles = new Promise<void>(() => {});
    const methodResponse = (await handler.handle(
      requestFromPeer(
        new Request(
          "http://localhost/_dev/ui/index.js",
          {
            method: "POST",
            headers: { host: "localhost" },
            body: new ReadableStream<Uint8Array>({
              cancel() {
                cancelled = true;
                return cancellationNeverSettles;
              },
            }),
            duplex: "half",
          } as RequestInit & { duplex: "half" },
        ),
      ),
      localContext(),
    )).response!;
    assertEquals(methodResponse.status, 405);
    assertEquals(methodResponse.headers.get("allow"), "GET, HEAD");
    assertEquals(cancelled, true);

    const missingAsset = (await handler.handle(
      dashboardRequest("http://localhost/_dev/ui/components/App.js"),
      localContext(),
    )).response!;
    assertEquals(missingAsset.status, 404);

    const unavailable = new DevDashboardHandler();
    const unavailableShell = (await unavailable.handle(
      dashboardRequest("http://localhost/_dev"),
      localContext(),
    )).response!;
    assertEquals(unavailableShell.status, 503);
    assertEquals(unavailableShell.headers.get("cache-control"), "no-store");
    assertEquals(unavailableShell.headers.get("content-type"), "text/plain; charset=utf-8");
    assertStringIncludes(await unavailableShell.text(), "@veryfront/ext-dev-ui-react");

    const unavailableBundle = (await unavailable.handle(
      dashboardRequest("http://localhost/_dev/ui/index.js"),
      localContext(),
    )).response!;
    assertEquals(unavailableBundle.status, 503);
    assertEquals(unavailableBundle.headers.get("content-type"), "text/plain; charset=utf-8");
    assertStringIncludes(await unavailableBundle.text(), "@veryfront/ext-dev-ui-react");

    const unavailableBundleHead = (await unavailable.handle(
      requestFromPeer(
        new Request("http://localhost/_dev/ui/index.js", {
          method: "HEAD",
          headers: { host: "localhost" },
        }),
      ),
      localContext(),
    )).response!;
    assertEquals(unavailableBundleHead.status, unavailableBundle.status);
    assertEquals(
      unavailableBundleHead.headers.get("content-type"),
      unavailableBundle.headers.get("content-type"),
    );
    assertEquals(await unavailableBundleHead.text(), "");
  });

  it("keeps non-local projects outside the dashboard handler", async () => {
    const result = await new DevDashboardHandler().handle(
      dashboardRequest("http://localhost/_dev"),
      { ...localContext(), isLocalProject: false },
    );
    assertEquals(result.continue, true);
    assertEquals(result.response, undefined);
  });
});
