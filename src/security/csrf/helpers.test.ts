import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertNotEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { applyCsrfCookie, csrfCookieSetting, generateCsrfToken, validateCsrf } from "./helpers.ts";

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

    it("should skip asset paths with file extensions", () => {
      const req = new Request("http://localhost/static/app.js", {
        headers: { accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      assertEquals(headers.get("set-cookie"), null);
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
