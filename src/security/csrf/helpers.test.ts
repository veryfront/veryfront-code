import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { applyCsrfCookie, csrfCookieSetting, generateCsrfToken, validateCsrf } from "./helpers.ts";
import { CSRF_NAMES_COOKIE_NAME, csrfHttpTokenCookieName, csrfNamesCookieName } from "./names.ts";

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

    it("accepts the origin-scoped HTTP token while a legacy configured token coexists", () => {
      const origin = "http://example.test:3000";
      const scopedName = csrfHttpTokenCookieName("my_csrf", origin);
      const req = new Request(`${origin}/api`, {
        method: "POST",
        headers: {
          cookie: `my_csrf=legacy-token; ${scopedName}=scoped-token`,
          "x-my-csrf": "scoped-token",
        },
      });

      assertEquals(
        validateCsrf(req, { cookieName: "my_csrf", headerName: "x-my-csrf" }),
        true,
      );
    });

    it("accepts a derived HTTP default when only the header name is customized", () => {
      const origin = "http://example.test:3000";
      const scopedName = csrfHttpTokenCookieName("vf_csrf", origin);
      const req = new Request(`${origin}/api`, {
        method: "POST",
        headers: {
          cookie: `${scopedName}=scoped-token`,
          "x-project-csrf": "scoped-token",
        },
      });

      assertEquals(validateCsrf(req, { headerName: "x-project-csrf" }), true);
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
      const origin = "http://192.168.1.20:3000";
      const req = new Request(`${origin}/`, {
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      const cookies = headers.getSetCookie();
      const tokenName = csrfHttpTokenCookieName("vf_csrf", origin);
      const token = cookies.find((cookie) => cookie.startsWith(`${tokenName}=`));
      assertExists(token, "the default HTTP token must not share its name with HTTPS siblings");
      assertEquals(token.includes("; Secure"), false);
      assertEquals(cookies.some((cookie) => cookie.startsWith("vf_csrf=")), false);
      assertExists(
        cookies.find((cookie) =>
          cookie.startsWith(`${csrfNamesCookieName(origin)}=`) && cookie.includes(tokenName)
        ),
        "the zero-option browser helper must discover the isolated default token",
      );
    });

    it("applies the LAN fallback when config explicitly repeats the secure default", () => {
      const origin = "http://192.168.1.20:3000";
      const req = new Request(`${origin}/`, {
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, { cookieName: "__Host-vf_csrf" });

      const cookies = headers.getSetCookie();
      const tokenName = csrfHttpTokenCookieName("vf_csrf", origin);
      const tokenCookie = cookies.find((cookie) => cookie.startsWith(`${tokenName}=`));
      assertExists(tokenCookie, "the explicit documented default must remain usable on LAN HTTP");
      assertEquals(tokenCookie.includes("; Secure"), false);
      assertEquals(
        cookies.some((cookie) =>
          cookie.startsWith(`${csrfNamesCookieName(origin)}=`) && cookie.includes(tokenName)
        ),
        true,
        "the browser helper must discover the origin-selected fallback name",
      );
    });

    it("origin-scopes the HTTP default when only the header name is customized", () => {
      const origin = "http://192.168.1.20:3000";
      const headers = new Headers();
      applyCsrfCookie(
        new Request(`${origin}/`, { headers: { accept: "text/html" } }),
        headers,
        { headerName: "x-project-csrf" },
      );

      const cookies = headers.getSetCookie();
      const tokenName = csrfHttpTokenCookieName("vf_csrf", origin);
      assertExists(
        cookies.find((cookie) => cookie.startsWith(`${tokenName}=`)),
        "an HTTPS sibling that explicitly uses vf_csrf must not own the HTTP token name",
      );
      assertExists(
        cookies.find((cookie) =>
          cookie.startsWith(`${csrfNamesCookieName(origin)}=`) && cookie.includes(tokenName)
        ),
        "the browser helper must discover the origin-scoped token with the custom header",
      );
    });

    it("keeps a default HTTP token isolated from an HTTPS custom sibling", () => {
      const httpOrigin = "http://example.test:3000";
      const httpsOrigin = "https://example.test:4000";
      const httpHeaders = new Headers();
      applyCsrfCookie(
        new Request(`${httpOrigin}/`, { headers: { accept: "text/html" } }),
        httpHeaders,
        true,
      );

      const httpCookies = httpHeaders.getSetCookie();
      const httpTokenName = csrfHttpTokenCookieName("vf_csrf", httpOrigin);
      const httpTokenCookie = httpCookies.find((cookie) => cookie.startsWith(`${httpTokenName}=`));
      assertExists(httpTokenCookie);
      const browserCookies = httpCookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");

      const httpsHeaders = new Headers();
      applyCsrfCookie(
        new Request(`${httpsOrigin}/`, {
          headers: { accept: "text/html", cookie: browserCookies },
        }),
        httpsHeaders,
        { cookieName: "vf_csrf" },
      );
      const httpsToken = httpsHeaders.getSetCookie().find((cookie) =>
        cookie.startsWith("vf_csrf=")
      );
      assertExists(httpsToken, "the HTTPS sibling still receives its configured token");
      assertStringIncludes(httpsToken, "Secure");

      const token = httpTokenCookie.slice(httpTokenName.length + 1).split(";", 1)[0]!;
      assertEquals(
        validateCsrf(
          new Request(`${httpOrigin}/api`, {
            method: "POST",
            headers: {
              cookie: browserCookies,
              "x-csrf-token": token,
            },
          }),
        ),
        true,
        "upgrading the sibling cookie cannot make the origin-scoped HTTP token unreadable",
      );
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
      const origin = "http://localhost";
      const req = new Request(`${origin}/`, {
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, { cookieName: "my_csrf" });

      const setCookie = headers.get("set-cookie");
      assertNotEquals(setCookie, null);
      assertEquals(
        setCookie!.includes(`${csrfHttpTokenCookieName("my_csrf", origin)}=`),
        true,
      );
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
    assertEquals(
      setCookies(headers).some((cookie) => cookie.startsWith("__Host-vf_csrf=")),
      false,
      "returning to defaults must not rotate or reissue an existing token",
    );
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
    const token = setCookies(headers).find((cookie) => cookie.startsWith("__Host-vf_csrf="));
    assertExists(token, "the token must be reissued with the advertisement");
    assertStringIncludes(token, "__Host-vf_csrf=existing-token", "the token value must not rotate");
  });

  it("synchronizes token and advertisement TTLs when configuration changes", () => {
    const headers = new Headers();
    const req = new Request("https://example.test/page", {
      headers: {
        accept: "text/html",
        cookie: `vf_csrf=existing-token; ${advertisementCookieName}=` +
          "https://example.test:vf_csrf:x-old",
      },
    });

    applyCsrfCookie(req, headers, {
      cookieName: "vf_csrf",
      headerName: "x-new",
      ttlSec: 60,
    });

    const refreshed = setCookies(headers);
    const token = refreshed.find((cookie) => cookie.startsWith("vf_csrf="));
    const advertisement = refreshed.find((cookie) =>
      cookie.startsWith(`${advertisementCookieName}=`)
    );
    assertExists(token, "a changed advertisement must refresh its token too");
    assertExists(advertisement, "the changed advertisement must be published");
    assertStringIncludes(token, "vf_csrf=existing-token", "the token value must not rotate");
    assertStringIncludes(token, "Max-Age=60");
    assertStringIncludes(token, "SameSite=Lax", "token cookie flags must be preserved");
    assertStringIncludes(token, "Secure", "the token cookie must preserve the Secure decision");
    assertEquals(token.includes("HttpOnly"), false, "the token must remain browser-readable");
    assertStringIncludes(advertisement, "Max-Age=60");
  });

  it("does not reissue cookies when the existing advertisement is current", () => {
    const headers = new Headers();
    const req = new Request("https://example.test/page", {
      headers: {
        accept: "text/html",
        cookie: `vf_csrf=existing-token; ${advertisementCookieName}=` +
          "https://example.test:vf_csrf:x-current",
      },
    });

    applyCsrfCookie(req, headers, {
      cookieName: "vf_csrf",
      headerName: "x-current",
      ttlSec: 60,
    });

    assertEquals(
      setCookies(headers),
      [],
      "an unchanged advertisement must not churn cookies on every document request",
    );
  });

  it("refreshes an equal advertisement when issuing a fresh token", () => {
    const headers = new Headers();
    const req = new Request("https://example.test/page", {
      headers: {
        accept: "text/html",
        cookie: `${advertisementCookieName}=https://example.test:vf_csrf:x-custom-csrf`,
      },
    });

    applyCsrfCookie(req, headers, {
      cookieName: "vf_csrf",
      headerName: "x-custom-csrf",
    });

    assertEquals(
      setCookies(headers).some((cookie) => cookie.startsWith(`${advertisementCookieName}=`)),
      true,
      "a fresh token and its discovery advertisement must regain the same lifetime",
    );
  });

  it("validates ttlSec before refreshing an advertisement for an existing token", () => {
    assertThrows(
      () =>
        applyCsrfCookie(
          new Request("https://example.test/page", {
            headers: { accept: "text/html", cookie: "vf_csrf=existing" },
          }),
          new Headers(),
          { cookieName: "vf_csrf", headerName: "x-custom-csrf", ttlSec: 0 },
        ),
      RangeError,
      "ttlSec",
    );
  });

  it("publishes a missing HTTP advertisement without extending its token or sibling", () => {
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

    const cookies = setCookies(headers);
    const current = cookies.find((cookie) => cookie.startsWith(`${secondAdvertisement}=`));
    assertExists(current, "the current HTTP origin must discover its existing token");
    assertStringIncludes(current, encodeURIComponent(`${secondOrigin}:vf_second:x-second`));
    assertEquals(
      cookies.some((cookie) => cookie.startsWith(`${firstAdvertisement}=`)),
      false,
      "the response must not replace or expire the sibling origin's retained cookie",
    );
    assertEquals(
      cookies.some((cookie) => cookie.startsWith("vf_second=")),
      false,
      "publishing discovery must not extend the existing token lifetime",
    );
  });

  it("extends known sibling advertisements when publishing a missing current advertisement", () => {
    const firstOrigin = "https://example.test:3000";
    const secondOrigin = "https://example.test:4000";
    const firstAdvertisement = csrfNamesCookieName(firstOrigin);
    const secondAdvertisement = csrfNamesCookieName(secondOrigin);
    const headers = new Headers();
    const req = new Request(`${secondOrigin}/page`, {
      headers: {
        accept: "text/html",
        cookie: `${firstAdvertisement}=${firstOrigin}:vf_csrf:x-first; vf_csrf=shared-token`,
      },
    });

    applyCsrfCookie(req, headers, {
      cookieName: "vf_csrf",
      headerName: "x-second",
    });

    const cookies = setCookies(headers);
    const first = cookies.find((cookie) => cookie.startsWith(`${firstAdvertisement}=`));
    const second = cookies.find((cookie) => cookie.startsWith(`${secondAdvertisement}=`));
    const token = cookies.find((cookie) => cookie.startsWith("vf_csrf="));

    assertExists(first, "the retained sibling advertisement must be refreshed with the token");
    assertExists(second, "the second origin must publish its own advertisement");
    assertExists(token, "publishing a missing advertisement must align the host-wide token");
  });

  it("synchronizes a missing current advertisement with known siblings and the shared token", () => {
    const firstOrigin = "https://example.test:3000";
    const secondOrigin = "https://example.test:4000";
    const firstAdvertisement = csrfNamesCookieName(firstOrigin);
    const secondAdvertisement = csrfNamesCookieName(secondOrigin);
    const forgedAdvertisement = `${CSRF_NAMES_COOKIE_NAME}_forged`;
    const headers = new Headers();
    const req = new Request(`${secondOrigin}/page`, {
      headers: {
        accept: "text/html",
        cookie: `vf_csrf=shared-token; ${firstAdvertisement}=${firstOrigin}:vf_csrf:x-first; ` +
          `${forgedAdvertisement}=${firstOrigin}:vf_csrf:x-forged`,
      },
    });

    applyCsrfCookie(req, headers, {
      cookieName: "vf_csrf",
      headerName: "x-second",
      ttlSec: 60,
    });

    const cookies = setCookies(headers);
    const first = cookies.find((cookie) => cookie.startsWith(`${firstAdvertisement}=`));
    const second = cookies.find((cookie) => cookie.startsWith(`${secondAdvertisement}=`));
    const forged = cookies.find((cookie) => cookie.startsWith(`${forgedAdvertisement}=`));
    const token = cookies.find((cookie) => cookie.startsWith("vf_csrf="));

    assertExists(first, "the known sibling advertisement must match the refreshed token TTL");
    assertStringIncludes(first, encodeURIComponent(`${firstOrigin}:vf_csrf:x-first`));
    assertStringIncludes(first, "Max-Age=60");
    assertExists(second, "the missing current advertisement must be published");
    assertStringIncludes(second, encodeURIComponent(`${secondOrigin}:vf_csrf:x-second`));
    assertStringIncludes(second, "Max-Age=60");
    assertEquals(forged, undefined, "forged advertisement cookie names must not be reflected");
    assertExists(
      token,
      "the retained shared token must be reissued so discovery lifetime is not unknown",
    );
    assertStringIncludes(token, "vf_csrf=shared-token", "the shared token value must not rotate");
    assertStringIncludes(token, "Max-Age=60");
  });

  it("keeps known sibling advertisements aligned when refreshing a shared token", () => {
    const firstOrigin = "https://example.test:3000";
    const secondOrigin = "https://example.test:4000";
    const firstAdvertisement = csrfNamesCookieName(firstOrigin);
    const secondAdvertisement = csrfNamesCookieName(secondOrigin);
    const forgedAdvertisement = `${CSRF_NAMES_COOKIE_NAME}_forged`;
    const headers = new Headers();
    const req = new Request(`${secondOrigin}/page`, {
      headers: {
        accept: "text/html",
        cookie: `vf_csrf=shared-token; ${firstAdvertisement}=${firstOrigin}:vf_csrf:x-first; ` +
          `${forgedAdvertisement}=${firstOrigin}:vf_csrf:x-forged; ` +
          `${secondAdvertisement}=${secondOrigin}:vf_csrf:x-old`,
      },
    });

    applyCsrfCookie(req, headers, {
      cookieName: "vf_csrf",
      headerName: "x-second",
      ttlSec: 60,
    });

    const cookies = setCookies(headers);
    const first = cookies.find((cookie) => cookie.startsWith(`${firstAdvertisement}=`));
    const second = cookies.find((cookie) => cookie.startsWith(`${secondAdvertisement}=`));
    const forged = cookies.find((cookie) => cookie.startsWith(`${forgedAdvertisement}=`));
    const token = cookies.find((cookie) => cookie.startsWith("vf_csrf="));

    assertExists(first, "the sibling advertisement must not expire before the shared token");
    assertStringIncludes(first, encodeURIComponent(`${firstOrigin}:vf_csrf:x-first`));
    assertStringIncludes(first, "Max-Age=60");
    assertEquals(forged, undefined, "forged advertisement cookie names must not be reflected");
    assertExists(second, "the current origin advertisement must be refreshed");
    assertStringIncludes(second, encodeURIComponent(`${secondOrigin}:vf_csrf:x-second`));
    assertStringIncludes(second, "Max-Age=60");
    assertExists(token, "the shared token lifetime must stay synchronized");
    assertStringIncludes(token, "vf_csrf=shared-token", "the shared token value must not rotate");
    assertStringIncludes(token, "Max-Age=60");
  });

  it("does not let a mixed-scheme sibling advertisement downgrade an HTTPS token", () => {
    const httpOrigin = "http://example.test:3000";
    const httpsOrigin = "https://example.test:4000";
    const httpAdvertisement = csrfNamesCookieName(httpOrigin);
    const httpsAdvertisement = csrfNamesCookieName(httpsOrigin);
    const headers = new Headers();
    const req = new Request(`${httpsOrigin}/page`, {
      headers: {
        accept: "text/html",
        cookie: `vf_csrf=shared-token; ${httpAdvertisement}=${httpOrigin}:vf_csrf:x-http; ` +
          `${httpsAdvertisement}=${httpsOrigin}:vf_csrf:x-old`,
      },
    });

    applyCsrfCookie(req, headers, {
      cookieName: "vf_csrf",
      headerName: "x-https",
      ttlSec: 60,
    });

    const cookies = setCookies(headers);
    const httpSibling = cookies.find((cookie) => cookie.startsWith(`${httpAdvertisement}=`));
    const httpsCurrent = cookies.find((cookie) => cookie.startsWith(`${httpsAdvertisement}=`));
    const token = cookies.find((cookie) => cookie.startsWith("vf_csrf="));

    assertExists(
      httpSibling,
      "the HTTP sibling advertisement must stay aligned with the refreshed shared token",
    );
    assertEquals(
      httpSibling.includes("Secure"),
      false,
      "an HTTP sibling advertisement must not be rewritten with HTTPS-only scope",
    );
    assertExists(httpsCurrent, "the HTTPS current advertisement must still be refreshed");
    assertStringIncludes(
      httpsCurrent,
      "Secure",
      "the current HTTPS advertisement must retain HTTPS-only scope",
    );
    assertExists(token, "the shared token must still be synchronized with the stale refresh");
    assertStringIncludes(
      token,
      "Secure",
      "client-writable sibling advertisements must not relax the token security attributes",
    );
  });

  it("upgrades a host-wide token to Secure despite a claimed HTTP sibling", () => {
    const httpOrigin = "http://example.test:3000";
    const httpsOrigin = "https://example.test:4000";
    const httpAdvertisement = csrfNamesCookieName(httpOrigin);
    const httpsAdvertisement = csrfNamesCookieName(httpsOrigin);
    const headers = new Headers();
    const req = new Request(`${httpsOrigin}/page`, {
      headers: {
        accept: "text/html",
        cookie: `vf_csrf=shared-token; ${httpAdvertisement}=${httpOrigin}:vf_csrf:x-http`,
      },
    });

    applyCsrfCookie(req, headers, {
      cookieName: "vf_csrf",
      headerName: "x-https",
      ttlSec: 60,
    });

    const cookies = setCookies(headers);
    const httpSibling = cookies.find((cookie) => cookie.startsWith(`${httpAdvertisement}=`));
    const httpsCurrent = cookies.find((cookie) => cookie.startsWith(`${httpsAdvertisement}=`));
    const token = cookies.find((cookie) => cookie.startsWith("vf_csrf="));

    assertExists(
      httpSibling,
      "the HTTP sibling advertisement must stay aligned with the refreshed shared token",
    );
    assertExists(httpsCurrent, "the HTTPS sibling must publish its missing advertisement");
    assertStringIncludes(
      httpsCurrent,
      "Secure",
      "the HTTPS advertisement can stay scoped to the HTTPS document",
    );
    assertExists(token, "the shared token lifetime must still be synchronized");
    assertStringIncludes(token, "vf_csrf=shared-token", "the shared token value must not rotate");
    assertStringIncludes(
      token,
      "Secure",
      "an unauthenticated HTTP advertisement must not keep the HTTPS token insecure",
    );
  });

  it("refreshes an HTTP advertisement without extending an invisible HTTPS sibling", () => {
    const httpOrigin = "http://example.test:3000";
    const httpsOrigin = "https://example.test:4000";
    const httpAdvertisement = csrfNamesCookieName(httpOrigin);
    const httpsAdvertisement = csrfNamesCookieName(httpsOrigin);
    const headers = new Headers();
    const req = new Request(`${httpOrigin}/page`, {
      headers: {
        accept: "text/html",
        cookie: `vf_csrf=shared-token; ${httpAdvertisement}=${httpOrigin}:vf_csrf:x-stale`,
      },
    });

    applyCsrfCookie(req, headers, {
      cookieName: "vf_csrf",
      headerName: "x-http",
      ttlSec: 60,
    });

    const cookies = setCookies(headers);
    const httpCurrent = cookies.find((cookie) => cookie.startsWith(`${httpAdvertisement}=`));
    const httpsInvisible = cookies.find((cookie) => cookie.startsWith(`${httpsAdvertisement}=`));
    const token = cookies.find((cookie) => cookie.startsWith("vf_csrf="));

    assertExists(httpCurrent, "the HTTP helper must discover the configured header immediately");
    assertStringIncludes(httpCurrent, encodeURIComponent(`${httpOrigin}:vf_csrf:x-http`));
    assertStringIncludes(httpCurrent, "Max-Age=60");
    assertEquals(
      httpsInvisible,
      undefined,
      "an HTTP request cannot refresh the sibling HTTPS Secure advertisement it cannot see",
    );
    assertEquals(
      token,
      undefined,
      "the HTTP refresh must not extend a shared token beyond an invisible HTTPS advertisement",
    );
  });

  it("refreshes an existing HTTP-only advertisement without extending its token", () => {
    const httpOrigin = "http://example.test:3000";
    const httpAdvertisement = csrfNamesCookieName(httpOrigin);
    const headers = new Headers();
    const req = new Request(`${httpOrigin}/page`, {
      headers: {
        accept: "text/html",
        cookie: `vf_csrf=shared-token; ${httpAdvertisement}=${httpOrigin}:vf_csrf:x-stale`,
      },
    });

    applyCsrfCookie(req, headers, {
      cookieName: "vf_csrf",
      headerName: "x-http",
      ttlSec: 60,
    });

    const cookies = setCookies(headers);
    const httpCurrent = cookies.find((cookie) => cookie.startsWith(`${httpAdvertisement}=`));
    const token = cookies.find((cookie) => cookie.startsWith("vf_csrf="));

    assertExists(httpCurrent, "a changed HTTP header must replace stale discovery immediately");
    assertStringIncludes(httpCurrent, encodeURIComponent(`${httpOrigin}:vf_csrf:x-http`));
    assertStringIncludes(httpCurrent, "Max-Age=60");
    assertEquals(
      token,
      undefined,
      "the existing HTTP token keeps its original lifetime until the pair expires",
    );
  });

  it("refreshes only the current HTTP advertisement when HTTPS siblings are visible", () => {
    const httpOrigin = "http://example.test:3000";
    const httpsOrigin = "https://example.test:4000";
    const httpAdvertisement = csrfNamesCookieName(httpOrigin);
    const httpsAdvertisement = csrfNamesCookieName(httpsOrigin);
    const headers = new Headers();
    const req = new Request(`${httpOrigin}/page`, {
      headers: {
        accept: "text/html",
        cookie: `vf_csrf=shared-token; ${httpAdvertisement}=${httpOrigin}:vf_csrf:x-stale; ` +
          `${httpsAdvertisement}=${httpsOrigin}:vf_csrf:x-https`,
      },
    });

    applyCsrfCookie(req, headers, {
      cookieName: "vf_csrf",
      headerName: "x-http",
      ttlSec: 60,
    });

    const cookies = setCookies(headers);
    const httpCurrent = cookies.find((cookie) => cookie.startsWith(`${httpAdvertisement}=`));
    const httpsSibling = cookies.find((cookie) => cookie.startsWith(`${httpsAdvertisement}=`));
    const token = cookies.find((cookie) => cookie.startsWith("vf_csrf="));

    assertExists(httpCurrent, "the current HTTP helper must not retain a stale header name");
    assertStringIncludes(httpCurrent, encodeURIComponent(`${httpOrigin}:vf_csrf:x-http`));
    assertStringIncludes(httpCurrent, "Max-Age=60");
    assertEquals(
      httpsSibling,
      undefined,
      "the HTTP response must not attempt to refresh the HTTPS sibling advertisement",
    );
    assertEquals(
      token,
      undefined,
      "the shared token must not gain a new full TTL when a HTTPS sibling is involved",
    );
  });

  it("issues a fresh HTTP custom token pair after the previous pair expires", () => {
    const httpOrigin = "http://example.test:3000";
    const httpAdvertisement = csrfNamesCookieName(httpOrigin);
    const httpTokenName = csrfHttpTokenCookieName("vf_csrf", httpOrigin);
    const headers = new Headers();
    const req = new Request(`${httpOrigin}/page`, {
      headers: {
        accept: "text/html",
      },
    });

    applyCsrfCookie(req, headers, {
      cookieName: "vf_csrf",
      headerName: "x-http",
      ttlSec: 60,
    });

    const cookies = setCookies(headers);
    const httpCurrent = cookies.find((cookie) => cookie.startsWith(`${httpAdvertisement}=`));
    const token = cookies.find((cookie) => cookie.startsWith(`${httpTokenName}=`));

    assertExists(httpCurrent, "a missing advertisement is safe to issue with a fresh token");
    assertStringIncludes(
      httpCurrent,
      encodeURIComponent(`${httpOrigin}:${httpTokenName}:x-http`),
    );
    assertStringIncludes(httpCurrent, "Max-Age=60");
    assertEquals(httpCurrent.includes("Secure"), false);
    assertExists(token, "the missing HTTP custom token must be issued with its advertisement");
    assertStringIncludes(token, "Max-Age=60");
    assertEquals(token.includes("Secure"), false);
  });

  it("isolates an HTTP token when an HTTPS sibling owns the configured Secure name", () => {
    const httpsOrigin = "https://example.test:4000";
    const httpOrigin = "http://example.test:3000";
    const config = { cookieName: "vf_csrf", headerName: "x-http", ttlSec: 60 };
    const httpsHeaders = new Headers();
    applyCsrfCookie(
      new Request(`${httpsOrigin}/page`, { headers: { accept: "text/html" } }),
      httpsHeaders,
      config,
    );
    const httpsToken = setCookies(httpsHeaders).find((cookie) => cookie.startsWith("vf_csrf="));
    assertExists(httpsToken, "the HTTPS application must own the configured token name");
    assertStringIncludes(httpsToken, "Secure");

    // Secure cookies are absent from an HTTP Cookie header, and browsers reject
    // an insecure Set-Cookie that tries to overlay one with the same name.
    const httpHeaders = new Headers();
    applyCsrfCookie(
      new Request(`${httpOrigin}/page`, { headers: { accept: "text/html" } }),
      httpHeaders,
      config,
    );
    const httpTokenName = csrfHttpTokenCookieName("vf_csrf", httpOrigin);
    const httpCookies = setCookies(httpHeaders);
    const httpToken = httpCookies.find((cookie) => cookie.startsWith(`${httpTokenName}=`));
    assertExists(httpToken, "HTTP must receive an origin-scoped token with no Secure collision");
    assertEquals(httpToken.includes("Secure"), false);
    assertEquals(
      httpCookies.some((cookie) => cookie.startsWith("vf_csrf=")),
      false,
      "HTTP must not attempt to overwrite the HTTPS Secure token",
    );

    const token = httpToken.slice(httpTokenName.length + 1).split(";", 1)[0]!;
    assertEquals(
      validateCsrf(
        new Request(`${httpOrigin}/api`, {
          method: "POST",
          headers: { cookie: `${httpTokenName}=${token}`, "x-http": token },
        }),
        config,
      ),
      true,
      "server validation must accept the advertised HTTP-scoped token",
    );
  });

  it("still refreshes an existing HTTPS custom token pair", () => {
    const httpsOrigin = "https://example.test:4000";
    const httpsAdvertisement = csrfNamesCookieName(httpsOrigin);
    const headers = new Headers();
    const req = new Request(`${httpsOrigin}/page`, {
      headers: {
        accept: "text/html",
        cookie: `vf_csrf=shared-token; ${httpsAdvertisement}=${httpsOrigin}:vf_csrf:x-stale`,
      },
    });

    applyCsrfCookie(req, headers, {
      cookieName: "vf_csrf",
      headerName: "x-https",
      ttlSec: 60,
    });

    const cookies = setCookies(headers);
    const httpsCurrent = cookies.find((cookie) => cookie.startsWith(`${httpsAdvertisement}=`));
    const token = cookies.find((cookie) => cookie.startsWith("vf_csrf="));

    assertExists(httpsCurrent, "HTTPS can keep the custom advertisement synchronized");
    assertStringIncludes(httpsCurrent, encodeURIComponent(`${httpsOrigin}:vf_csrf:x-https`));
    assertStringIncludes(httpsCurrent, "Max-Age=60");
    assertStringIncludes(httpsCurrent, "Secure");
    assertExists(token, "HTTPS can refresh the existing custom token with the advertisement");
    assertStringIncludes(token, "vf_csrf=shared-token");
    assertStringIncludes(token, "Max-Age=60");
    assertStringIncludes(token, "Secure");
  });

  it("preserves Secure when refreshing an existing __Secure- token", () => {
    const httpOrigin = "http://localhost";
    const httpAdvertisement = csrfNamesCookieName(httpOrigin);
    const headers = new Headers();
    const req = new Request(`${httpOrigin}/page`, {
      headers: {
        accept: "text/html",
        cookie: `__Secure-vf_csrf=existing-token; ${httpAdvertisement}=` +
          `${httpOrigin}:__Secure-vf_csrf:x-old`,
      },
    });

    applyCsrfCookie(req, headers, {
      cookieName: "__Secure-vf_csrf",
      headerName: "x-new",
      ttlSec: 60,
    });

    const token = setCookies(headers).find((cookie) => cookie.startsWith("__Secure-vf_csrf="));
    assertExists(token, "the existing __Secure- token must be reissued with the advertisement");
    assertStringIncludes(
      token,
      "; Secure",
      "__Secure- cookies must keep their mandatory Secure attribute when refreshed",
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
});
