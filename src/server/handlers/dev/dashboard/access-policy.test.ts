import { assertEquals, assertMatch, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createDashboardSessionCookie,
  DASHBOARD_CSRF_HEADER_NAME,
  getDashboardSessionToken,
  hasValidDashboardMutationSession,
  isTrustedDashboardRequest,
} from "./access-policy.ts";
import { getDashboardSessionCookieName } from "#veryfront/extensions/dev-ui/protocol";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";

function dashboardRequest(
  url: string,
  headers: HeadersInit = {},
  peerHostname = "127.0.0.1",
): Request {
  const parsed = new URL(url);
  const finalHeaders = new Headers(headers);
  if (!finalHeaders.has("host")) finalHeaders.set("host", parsed.host);
  const request = new Request(parsed, { headers: finalHeaders });
  recordRequestPeerFromTransport(request, {
    runtime: "node",
    transport: "tcp",
    hostname: peerHostname,
  });
  return request;
}

describe("dashboard access policy", () => {
  it("admits exact canonical local URL and Host pairs", () => {
    for (
      const url of [
        "http://localhost:8000/_dev",
        "http://127.0.0.1:8000/_dev/api/stats",
        "http://[::1]:8000/_dev/ui/index.js",
        "http://my-project.localhost:8000/_dev",
        "http://my-project.preview.localhost:8000/_dev/ui/index.js",
      ]
    ) {
      assertEquals(isTrustedDashboardRequest(dashboardRequest(url)), true, url);
    }
  });

  it("rejects bind-all, production, unknown, malformed, and oversized authorities", () => {
    for (
      const url of [
        "http://0.0.0.0:8000/_dev",
        "http://production.localhost:8000/_dev",
        "http://staging.localhost:8000/_dev",
        "http://my-project.production.localhost:8000/_dev",
        "http://my-project.staging.localhost:8000/_dev",
        "http://my-project.unknown.localhost:8000/_dev",
        "http://example.com.prod.localhost:8000/_dev",
        "http://a.b.c.localhost:8000/_dev",
        "http://localhost.attacker.example:8000/_dev",
        // Public wildcard-DNS roots resolving to 127.0.0.1 are ordinary
        // registrable domains, not dashboard authorities.
        "http://wildcard-dns.example:8000/_dev",
        "http://my-project.wildcard-dns.example:8000/_dev",
        "http://my-project.preview.wildcard-dns.example:8000/_dev",
      ]
    ) {
      assertEquals(isTrustedDashboardRequest(dashboardRequest(url)), false, url);
    }

    assertEquals(
      isTrustedDashboardRequest(
        dashboardRequest("http://localhost:8000/_dev", { host: "a".repeat(512) }),
      ),
      false,
    );
    assertEquals(
      isTrustedDashboardRequest(
        dashboardRequest(`http://localhost:8000/_dev?value=${"a".repeat(9_000)}`),
      ),
      false,
    );
    assertEquals(
      isTrustedDashboardRequest(
        dashboardRequest("http://localhost:8000/_dev", {
          "sec-fetch-site": "same-origin".repeat(100),
        }),
      ),
      false,
    );
  });

  it("rejects DNS-rebinding, missing, and mismatched hosts", () => {
    assertEquals(
      isTrustedDashboardRequest(dashboardRequest("http://evil.attacker:8000/_dev")),
      false,
    );
    assertEquals(
      isTrustedDashboardRequest(
        dashboardRequest("http://localhost:8000/_dev", { host: "" }),
      ),
      false,
    );
    assertEquals(
      isTrustedDashboardRequest(
        dashboardRequest("http://localhost:8000/_dev", { host: "127.0.0.1:8000" }),
      ),
      false,
    );
  });

  it("rejects missing transport provenance independently of Host validation", () => {
    assertEquals(
      isTrustedDashboardRequest(
        new Request("http://localhost:8000/_dev", {
          headers: { host: "localhost:8000" },
        }),
      ),
      false,
    );
  });

  it("rejects forged local authorities from non-loopback peers", () => {
    const token = getDashboardSessionToken();
    const cookieName = getDashboardSessionCookieName(8_000);
    const forged = dashboardRequest(
      "http://localhost:8000/_dev/api/hmr-trigger",
      {
        cookie: `${cookieName}=${token}`,
        origin: "http://localhost:8000",
        [DASHBOARD_CSRF_HEADER_NAME]: token,
      },
      "192.168.1.25",
    );

    assertEquals(isTrustedDashboardRequest(forged), false);
    assertEquals(hasValidDashboardMutationSession(forged), false);
    assertThrows(
      () => createDashboardSessionCookie(forged),
      TypeError,
      "untrusted request",
    );
  });

  it("rejects proxy-forwarded dashboard requests even from a loopback peer", () => {
    for (const header of ["forwarded", "x-forwarded-for", "x-real-ip"]) {
      assertEquals(
        isTrustedDashboardRequest(
          dashboardRequest("http://localhost:8000/_dev", {
            [header]: "203.0.113.8",
          }),
        ),
        false,
        header,
      );
    }
  });

  it("admits direct navigation and same-origin fetches but rejects cross-site work", () => {
    for (const fetchSite of ["none", "same-origin"]) {
      assertEquals(
        isTrustedDashboardRequest(
          dashboardRequest("http://localhost/_dev", { "sec-fetch-site": fetchSite }),
        ),
        true,
      );
    }
    for (const fetchSite of ["same-site", "cross-site"]) {
      assertEquals(
        isTrustedDashboardRequest(
          dashboardRequest("http://localhost/_dev", { "sec-fetch-site": fetchSite }),
        ),
        false,
      );
    }
  });

  it("requires matching cookie and header copies of the random session token", () => {
    const token = getDashboardSessionToken();
    assertMatch(token, /^[A-Za-z0-9_-]{43}$/);
    const cookieName = getDashboardSessionCookieName(80);
    const valid = dashboardRequest("http://localhost/_dev/api/hmr-trigger", {
      cookie: `${cookieName}=${token}`,
      [DASHBOARD_CSRF_HEADER_NAME]: token,
    });
    assertEquals(hasValidDashboardMutationSession(valid), true);

    const forged = dashboardRequest("http://localhost/_dev/api/hmr-trigger", {
      cookie: `${cookieName}=${token}`,
      [DASHBOARD_CSRF_HEADER_NAME]: "A".repeat(43),
    });
    assertEquals(hasValidDashboardMutationSession(forged), false);

    const wrongCookie = dashboardRequest("http://localhost/_dev/api/hmr-trigger", {
      cookie: `${cookieName}=${"B".repeat(43)}`,
      [DASHBOARD_CSRF_HEADER_NAME]: token,
    });
    assertEquals(
      hasValidDashboardMutationSession(wrongCookie),
      false,
      "a pattern-shaped but wrong cookie must not satisfy the double-submit credential",
    );
  });

  it("isolates dashboard session cookies across listener ports", () => {
    const token = getDashboardSessionToken();
    const port3000Cookie = createDashboardSessionCookie(
      dashboardRequest("http://localhost:3000/_dev"),
    ).split(";", 1)[0]!;
    const port3001Cookie = createDashboardSessionCookie(
      dashboardRequest("http://localhost:3001/_dev"),
    ).split(";", 1)[0]!;

    assertEquals(port3000Cookie.startsWith(`${getDashboardSessionCookieName(3000)}=`), true);
    assertEquals(port3001Cookie.startsWith(`${getDashboardSessionCookieName(3001)}=`), true);
    assertEquals(port3000Cookie === port3001Cookie, false);

    const wrongPort = dashboardRequest("http://localhost:3001/_dev/api/hmr-trigger", {
      cookie: port3000Cookie,
      [DASHBOARD_CSRF_HEADER_NAME]: token,
    });
    assertEquals(hasValidDashboardMutationSession(wrongPort), false);
  });

  it("rejects oversized session credentials before parsing or comparison", () => {
    const cookieName = getDashboardSessionCookieName(80);
    const token = getDashboardSessionToken();
    assertEquals(
      hasValidDashboardMutationSession(
        dashboardRequest("http://localhost/_dev/api/hmr-trigger", {
          cookie: `${cookieName}=${"A".repeat(16_384)}`,
          [DASHBOARD_CSRF_HEADER_NAME]: token,
        }),
      ),
      false,
    );
    assertEquals(
      hasValidDashboardMutationSession(
        dashboardRequest("http://localhost/_dev/api/hmr-trigger", {
          cookie: `${cookieName}=${token}`,
          [DASHBOARD_CSRF_HEADER_NAME]: "A".repeat(16_384),
        }),
      ),
      false,
    );
  });

  it("issues a host-only, HttpOnly, strict session cookie", () => {
    const cookie = createDashboardSessionCookie(dashboardRequest("http://localhost/_dev"));
    assertEquals(cookie.startsWith(`${getDashboardSessionCookieName(80)}=`), true);
    assertEquals(cookie.includes("Domain="), false);
    assertEquals(cookie.includes("Path=/_dev"), true);
    assertEquals(cookie.includes("HttpOnly"), true);
    assertEquals(cookie.includes("SameSite=Strict"), true);
    assertEquals(cookie.includes("Secure"), false);

    const secureCookie = createDashboardSessionCookie(
      dashboardRequest("https://localhost/_dev"),
    );
    assertEquals(secureCookie.startsWith(`${getDashboardSessionCookieName(443)}=`), true);
    assertEquals(secureCookie.includes("; Secure"), true);
  });

  it("does not issue a session cookie for an untrusted authority", () => {
    assertThrows(
      () => createDashboardSessionCookie(dashboardRequest("http://attacker.example/_dev")),
      TypeError,
      "untrusted request",
    );
  });
});
