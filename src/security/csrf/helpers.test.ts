import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import {
  applyCsrfCookie,
  browserFacingOrigin,
  csrfCookieSetting,
  generateCsrfToken,
  validateCsrf,
} from "./helpers.ts";
import { csrfNamesCookieName } from "./names.ts";

describe("security/csrf/helpers", () => {
  describe("generateCsrfToken", () => {
    it("should generate a token and Set-Cookie with HttpOnly and Secure by default", () => {
      const result = generateCsrfToken();
      assertEquals(typeof result.token, "string");
      assertEquals(result.token.length > 0, true);
      assertEquals(result.setCookie.startsWith("__Host-vf_csrf="), true);
      assertEquals(result.setCookie.includes("HttpOnly"), true);
      assertEquals(result.setCookie.includes("Secure"), true);
      assertEquals(result.setCookie.includes("SameSite=Lax"), true);
      assertEquals(result.setCookie.includes("Path=/"), true);
    });

    it("should omit HttpOnly when httpOnly is false", () => {
      const result = generateCsrfToken({ httpOnly: false });
      assertEquals(result.setCookie.includes("HttpOnly"), false);
      assertEquals(result.setCookie.includes("SameSite=Lax"), true);
    });

    it("should keep Secure for the default __Host- cookie when secure is false", () => {
      const result = generateCsrfToken({ secure: false });
      assertEquals(result.setCookie.startsWith("__Host-vf_csrf="), true);
      assertEquals(result.setCookie.includes("Secure"), true);
    });

    it("should omit Secure for custom non-__Host cookies when secure is false", () => {
      const result = generateCsrfToken({ cookieName: "my_csrf", secure: false });
      assertEquals(result.setCookie.includes("Secure"), false);
    });

    it("keeps Secure for __Secure- prefixed cookies", () => {
      const result = generateCsrfToken({
        cookieName: "__Secure-my_csrf",
        secure: false,
      });
      assertEquals(result.setCookie.includes("Secure"), true);
    });

    it("should use custom cookie name", () => {
      const result = generateCsrfToken({ cookieName: "my_csrf" });
      assertEquals(result.setCookie.startsWith("my_csrf="), true);
    });

    it("rejects cookie names reserved for configured-name discovery", () => {
      assertThrows(
        () => generateCsrfToken({ cookieName: "vf_csrf_names_forbidden" }),
        TypeError,
        "reserved",
        "public token generation must not mint a cookie inside the advertisement namespace",
      );
    });

    it("should use custom TTL", () => {
      const result = generateCsrfToken({ ttlSec: 300 });
      assertEquals(result.setCookie.includes("Max-Age=300"), true);
    });

    it("should generate unique tokens", () => {
      const a = generateCsrfToken();
      const b = generateCsrfToken();
      assertNotEquals(a.token, b.token);
    });

    it("rejects invalid cookie serialization options", () => {
      for (
        const options of [
          { cookieName: "bad\r\nname" },
          { cookieName: "" },
          { ttlSec: 0 },
          { ttlSec: Number.POSITIVE_INFINITY },
          { httpOnly: "yes" as unknown as boolean },
          { secure: "no" as unknown as boolean },
        ]
      ) {
        assertThrows(() => generateCsrfToken(options));
      }
    });
  });

  describe("validateCsrf", () => {
    it("should return true when cookie and header match", () => {
      const { token } = generateCsrfToken({ secure: false });
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: `__Host-vf_csrf=${token}`,
          "x-csrf-token": token,
        },
      });
      assertEquals(validateCsrf(req), true);
    });

    it("should return false when header is missing", () => {
      const { token } = generateCsrfToken({ secure: false });
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: { cookie: `__Host-vf_csrf=${token}` },
      });
      assertEquals(validateCsrf(req), false);
    });

    it("should return false when cookie is missing", () => {
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: { "x-csrf-token": "some-token" },
      });
      assertEquals(validateCsrf(req), false);
    });

    it("should return false when cookie and header mismatch", () => {
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: "__Host-vf_csrf=token-a",
          "x-csrf-token": "token-b",
        },
      });
      assertEquals(validateCsrf(req), false);
    });

    it("should use custom cookie and header names", () => {
      const { token } = generateCsrfToken({ cookieName: "my_csrf", secure: false });
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: `my_csrf=${token}`,
          "x-my-csrf": token,
        },
      });
      assertEquals(validateCsrf(req, { cookieName: "my_csrf", headerName: "x-my-csrf" }), true);
    });

    it("should return false when header token is empty string", () => {
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: "__Host-vf_csrf=some-token",
          "x-csrf-token": "",
        },
      });
      assertEquals(validateCsrf(req), false);
    });

    it("should return false on malformed cookie instead of throwing", () => {
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: "__Host-vf_csrf=%ZZbadvalue",
          "x-csrf-token": "anything",
        },
      });
      assertEquals(validateCsrf(req), false);
    });

    it("fails closed for invalid runtime names", () => {
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: "__Host-vf_csrf=token",
          "x-csrf-token": "token",
        },
      });

      assertEquals(
        validateCsrf(req, { cookieName: "bad\r\nname" }),
        false,
      );
      assertEquals(
        validateCsrf(req, { headerName: "" }),
        false,
      );
    });

    it("fails closed for a cookie name reserved for configured-name discovery", () => {
      const reservedName = "vf_csrf_names_forbidden";
      const req = new Request("https://example.com/api", {
        method: "POST",
        headers: {
          cookie: `${reservedName}=matching-token`,
          "x-csrf-token": "matching-token",
        },
      });

      assertEquals(
        validateCsrf(req, { cookieName: reservedName }),
        false,
        "reserved names must not become valid merely because their values match",
      );
    });
  });

  describe("applyCsrfCookie", () => {
    it("should set cookie on HTML document request", () => {
      const req = new Request("http://localhost/", {
        headers: { accept: "text/html,application/xhtml+xml" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      const setCookie = headers.get("set-cookie");
      assertNotEquals(setCookie, null);
      assertEquals(setCookie!.startsWith("__Host-vf_csrf="), true);
    });

    it("should set cookie on GET with text/html accept", () => {
      const req = new Request("http://localhost/", {
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      const setCookie = headers.get("set-cookie");
      assertNotEquals(setCookie, null);
      assertEquals(setCookie!.startsWith("__Host-vf_csrf="), true);
      assertEquals(setCookie!.includes("HttpOnly"), false); // double-submit needs JS access
      assertEquals(setCookie!.includes("Secure"), true); // __Host- cookies require Secure
    });

    it("should set Secure flag on HTTPS requests", () => {
      const req = new Request("https://example.com/", {
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      const setCookie = headers.get("set-cookie");
      assertNotEquals(setCookie, null);
      assertEquals(setCookie!.includes("Secure"), true);
    });

    it("should set Secure flag when x-forwarded-proto is https", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-forwarded-proto": "https", accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      const setCookie = headers.get("set-cookie");
      assertNotEquals(setCookie, null);
      assertEquals(setCookie!.includes("Secure"), true);
    });

    it("should not mark a non-__Host cookie Secure over plain http", () => {
      const req = new Request("http://localhost/", {
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, { cookieName: "vf_csrf" });

      assertEquals(
        headers.get("set-cookie")!.includes("Secure"),
        false,
        "a non-__Host cookie over plain http must not be marked Secure",
      );
    });

    it("should mark a non-__Host cookie Secure on an https request URL", () => {
      const req = new Request("https://example.com/", {
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, { cookieName: "vf_csrf" });

      assertEquals(
        headers.get("set-cookie")!.includes("Secure"),
        true,
        "an https request URL must mark the CSRF cookie Secure",
      );
    });

    // The trusted-topology arm of this branch needs a real process env mutation
    // and lives in tests/integration/security/csrf-proxy-topology.test.ts.
    it("should ignore x-forwarded-proto while the proxy topology is untrusted", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-forwarded-proto": "https", accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, { cookieName: "vf_csrf" });

      assertEquals(
        headers.get("set-cookie")!.includes("Secure"),
        false,
        "a spoofable forwarded-proto header must not control the Secure flag while the proxy topology is untrusted",
      );
    });

    it("should set cookie on HEAD when absent", () => {
      const req = new Request("http://localhost/", {
        method: "HEAD",
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      assertNotEquals(headers.get("set-cookie"), null);
    });

    it("should skip when cookie already present in request", () => {
      const req = new Request("http://localhost/", {
        headers: { cookie: "__Host-vf_csrf=existing-token" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      assertEquals(headers.get("set-cookie"), null);
    });

    it("should skip on POST requests", () => {
      const req = new Request("http://localhost/submit", { method: "POST" });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      assertEquals(headers.get("set-cookie"), null);
    });

    it("should skip non-HTML accept headers", () => {
      const req = new Request("http://localhost/api/data", {
        headers: { accept: "application/json" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      assertEquals(headers.get("set-cookie"), null);
    });

    it("should skip requests without Accept header (CLI/API clients)", () => {
      const req = new Request("http://localhost/");
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      assertEquals(headers.get("set-cookie"), null);
    });

    it("should skip accept: */* (non-browser clients)", () => {
      const req = new Request("http://localhost/", {
        headers: { accept: "*/*" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      assertEquals(headers.get("set-cookie"), null);
    });

    it("should skip internal /_veryfront paths", () => {
      const req = new Request("http://localhost/_veryfront/chunks/app.js", {
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      assertEquals(headers.get("set-cookie"), null);
    });

    it("should issue a token for dotted HTML routes", () => {
      const req = new Request("http://localhost/blog.post", {
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      assertEquals(
        headers.get("set-cookie")?.startsWith("__Host-vf_csrf="),
        true,
        "a route suffix does not make an HTML document an asset",
      );
    });

    it("uses a browser-compatible cookie on a plain-HTTP LAN origin", () => {
      const req = new Request("http://192.168.1.20:3000/", {
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      const setCookie = headers.get("set-cookie") ?? "";
      assertEquals(setCookie.startsWith("vf_csrf="), true);
      assertEquals(setCookie.includes("; Secure"), false);
    });

    it("should skip when csrf config is false", () => {
      const req = new Request("http://localhost/");
      const headers = new Headers();
      applyCsrfCookie(req, headers, false);

      assertEquals(headers.get("set-cookie"), null);
    });

    it("should skip when csrf config is undefined", () => {
      const req = new Request("http://localhost/");
      const headers = new Headers();
      applyCsrfCookie(req, headers, undefined);

      assertEquals(headers.get("set-cookie"), null);
    });

    it("should use custom cookie name from config object", () => {
      const req = new Request("http://localhost/", {
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, { cookieName: "my_csrf" });

      const setCookie = headers.get("set-cookie");
      assertNotEquals(setCookie, null);
      assertEquals(setCookie!.includes("my_csrf="), true);
    });

    it("should use custom ttlSec from config object", () => {
      const req = new Request("http://localhost/", {
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, { ttlSec: 600 });

      const setCookie = headers.get("set-cookie");
      assertEquals(setCookie!.includes("Max-Age=600"), true);
    });

    it("should reject an invalid ttlSec even when the token cookie already exists", () => {
      // The existing-token branch skips generateCsrfToken, so without its own
      // validation an invalid TTL would be interpolated straight into the name
      // advertisement cookie's Max-Age, expiring or corrupting it.
      for (const ttlSec of [0, -1, 1.5, Number.NaN]) {
        const req = new Request("http://localhost/", {
          headers: {
            accept: "text/html",
            cookie: "my_csrf=existing-token",
          },
        });
        const headers = new Headers();
        assertThrows(
          () =>
            applyCsrfCookie(req, headers, {
              cookieName: "my_csrf",
              headerName: "x-my-csrf",
              ttlSec,
            }),
          RangeError,
        );
        assertEquals(headers.get("set-cookie"), null);
      }
    });

    it("should apply a valid ttlSec to the advertisement refresh on the existing-token branch", () => {
      const req = new Request("http://localhost/", {
        headers: {
          accept: "text/html",
          cookie: "my_csrf=existing-token",
        },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, {
        cookieName: "my_csrf",
        headerName: "x-my-csrf",
        ttlSec: 600,
      });

      const setCookie = headers.get("set-cookie");
      assertExists(setCookie);
      assertStringIncludes(setCookie, csrfNamesCookieName("http://localhost"));
      assertStringIncludes(setCookie, "Max-Age=600");
    });

    it("should issue fresh token on malformed cookie instead of throwing", () => {
      const req = new Request("http://localhost/", {
        headers: { cookie: "__Host-vf_csrf=%ZZbadvalue", accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      const setCookie = headers.get("set-cookie");
      assertNotEquals(setCookie, null);
      assertEquals(setCookie!.startsWith("__Host-vf_csrf="), true);
    });
  });

  describe("csrfCookieSetting", () => {
    it("issues the token cookie locally when security.csrf is unset", () => {
      assertEquals(
        csrfCookieSetting(undefined, true),
        true,
        "an unset local project needs a token cookie so browser mutations have one to echo",
      );

      const req = new Request("http://localhost/", {
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, csrfCookieSetting(undefined, true));

      const setCookie = headers.get("set-cookie");
      assertNotEquals(
        setCookie,
        null,
        "a local HTML document response must carry the double-submit token cookie",
      );
      assertEquals(
        setCookie!.startsWith("__Host-vf_csrf="),
        true,
        "the local token uses the same default cookie name as production",
      );
      assertEquals(
        setCookie!.includes("HttpOnly"),
        false,
        "csrfMutationHeaders reads the cookie from document.cookie, so it must not be HttpOnly",
      );
    });

    it("never turns enforcement on and never overrides an explicit setting", () => {
      assertEquals(
        csrfCookieSetting(undefined, false),
        undefined,
        "a non-local surface keeps the unset setting so nothing changes outside development",
      );
      assertEquals(
        csrfCookieSetting(false, true),
        false,
        "an explicit opt-out is preserved locally and issues no cookie",
      );
      assertEquals(
        csrfCookieSetting(true, false),
        true,
        "an explicitly enabled setting is passed through untouched",
      );

      const config = { cookieName: "vf_csrf" };
      assertEquals(
        csrfCookieSetting(config, true),
        config,
        "an object setting is returned by identity so cookie and header overrides survive",
      );

      const req = new Request("http://localhost/", {
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, csrfCookieSetting(false, true));
      assertEquals(
        headers.get("set-cookie"),
        null,
        "an explicit opt-out must not gain a token cookie from local development",
      );
    });
  });
});

describe("applyCsrfCookie name advertisement", () => {
  const origin = "https://example.test";
  const advertisementCookieName = csrfNamesCookieName(origin);
  const htmlGet = () => new Request(`${origin}/page`, { headers: { accept: "text/html" } });

  function setCookies(headers: Headers): string[] {
    return headers.getSetCookie ? headers.getSetCookie() : [];
  }

  it("publishes configured names so the browser helper can discover them", () => {
    const headers = new Headers();
    applyCsrfCookie(htmlGet(), headers, {
      cookieName: "__Host-vf_project_csrf",
      headerName: "x-project-csrf",
    });

    const advertisement = setCookies(headers).find((c) =>
      c.startsWith(`${advertisementCookieName}=`)
    );
    assertExists(
      advertisement,
      "a configured project must advertise its names or the helper cannot discover them",
    );
    assertStringIncludes(
      advertisement,
      `${advertisementCookieName}=` +
        "https%3A%2F%2Fexample.test%3A__Host-vf_project_csrf%3Ax-project-csrf",
      "the advertisement must carry both configured names",
    );
    assertEquals(
      advertisement.includes("HttpOnly"),
      false,
      "the advertisement must stay readable by the browser helper",
    );
  });

  it("percent-encodes advertised names so cookie parsing round-trips percent characters", () => {
    const headers = new Headers();
    applyCsrfCookie(htmlGet(), headers, {
      cookieName: "vf%2Eproject%2Ecsrf",
      headerName: "x-project-csrf",
    });

    const advertisement = setCookies(headers).find((cookie) =>
      cookie.startsWith(`${advertisementCookieName}=`)
    );
    assertExists(advertisement, "a configured project must receive an advertisement");
    assertStringIncludes(
      advertisement,
      `${advertisementCookieName}=` +
        "https%3A%2F%2Fexample.test%3Avf%252Eproject%252Ecsrf%3Ax-project-csrf",
      "cookie decoding must recover the configured percent characters exactly once",
    );
  });

  it("adds no advertisement cookie for a default project", () => {
    const headers = new Headers();
    applyCsrfCookie(htmlGet(), headers, true);

    assertEquals(
      setCookies(headers).some((c) => c.startsWith(`${advertisementCookieName}=`)),
      false,
      "a default project must not receive a cookie it has no use for",
    );
  });

  it("expires a stale advertisement when a project returns to the default names", () => {
    const headers = new Headers();
    const req = new Request("https://example.test/page", {
      headers: {
        accept: "text/html",
        cookie: `__Host-vf_csrf=existing-token; ${advertisementCookieName}=` +
          "https://example.test:vf_old_csrf:x-old-csrf",
      },
    });

    applyCsrfCookie(req, headers, true);

    const advertisement = setCookies(headers).find((cookie) =>
      cookie.startsWith(`${advertisementCookieName}=`)
    );
    assertExists(
      advertisement,
      "the stale discovery value must be replaced when defaults are restored",
    );
    assertStringIncludes(advertisement, "Max-Age=0", "the stale discovery value must be expired");
  });
  it("refreshes a stale advertisement even when the token cookie already exists", () => {
    const headers = new Headers();
    const req = new Request("https://example.test/page", {
      headers: {
        accept: "text/html",
        cookie: `__Host-vf_csrf=existing-token; ${advertisementCookieName}=` +
          "https://example.test:__Host-vf_csrf:x-old",
      },
    });
    applyCsrfCookie(req, headers, { headerName: "x-new" });

    const advertisement = (headers.getSetCookie ? headers.getSetCookie() : [])
      .find((c) => c.startsWith(`${advertisementCookieName}=`));
    assertExists(
      advertisement,
      "changing only headerName must still refresh the advertisement",
    );
    assertStringIncludes(
      advertisement,
      "x-new",
      "the browser must be told the new header name, not the stale one",
    );
  });

  it("retains a sibling application's advertisement on another port", () => {
    const firstOrigin = "http://localhost:3000";
    const secondOrigin = "http://localhost:4000";
    const firstAdvertisement = csrfNamesCookieName(firstOrigin);
    const secondAdvertisement = csrfNamesCookieName(secondOrigin);
    const headers = new Headers();
    const req = new Request(`${secondOrigin}/page`, {
      headers: {
        accept: "text/html",
        cookie: `${firstAdvertisement}=${firstOrigin}:vf_first:x-first; vf_second=token`,
      },
    });

    applyCsrfCookie(req, headers, {
      cookieName: "vf_second",
      headerName: "x-second",
    });

    const setCookie = setCookies(headers).find((cookie) =>
      cookie.startsWith(`${secondAdvertisement}=`)
    );
    assertExists(setCookie, "the second origin must publish its own advertisement cookie");
    assertEquals(
      setCookies(headers).some((cookie) => cookie.startsWith(`${firstAdvertisement}=`)),
      false,
      "the response must not replace or expire the sibling origin's retained cookie",
    );
  });

  it("refuses a configured cookie name reserved for the advertisement", () => {
    assertThrows(
      () =>
        applyCsrfCookie(
          new Request("https://example.test/page", { headers: { accept: "text/html" } }),
          new Headers(),
          { cookieName: "vf_csrf_names" },
        ),
      TypeError,
      "reserved",
      "the advertisement must never be able to overwrite the token cookie",
    );
  });

  it("validates a header name supplied through the public API", () => {
    assertThrows(
      () =>
        applyCsrfCookie(
          new Request("https://example.test/page", { headers: { accept: "text/html" } }),
          new Headers(),
          { headerName: "x bad; Path=/" },
        ),
      TypeError,
      "CSRF headerName",
      "an unvalidated name would be interpolated straight into Set-Cookie",
    );
  });
  it("advertises the browser-facing origin behind a trusted proxy", () => {
    const req = new Request("http://internal.svc/page", {
      headers: {
        accept: "text/html",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "app.example.com",
      },
    });

    assertEquals(
      browserFacingOrigin(req, true),
      "https://app.example.com",
      "a proxied deployment must advertise the origin the document reports",
    );
    assertEquals(
      browserFacingOrigin(req, false),
      "http://internal.svc",
      "forwarded headers are client-spoofable, so an untrusting deployment ignores them",
    );
  });
});
