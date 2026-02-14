import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { applyCsrfCookie, generateCsrfToken, validateCsrf } from "./helpers.ts";

describe("security/csrf/helpers", () => {
  describe("generateCsrfToken", () => {
    it("should generate a token and Set-Cookie with HttpOnly and Secure by default", () => {
      const result = generateCsrfToken();
      assertEquals(typeof result.token, "string");
      assertEquals(result.token.length > 0, true);
      assertEquals(result.setCookie.includes("vf_csrf="), true);
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

    it("should omit Secure when secure is false", () => {
      const result = generateCsrfToken({ secure: false });
      assertEquals(result.setCookie.includes("Secure"), false);
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
  });

  describe("validateCsrf", () => {
    it("should return true when cookie and header match", () => {
      const { token } = generateCsrfToken({ secure: false });
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: `vf_csrf=${token}`,
          "x-csrf-token": token,
        },
      });
      assertEquals(validateCsrf(req), true);
    });

    it("should return false when header is missing", () => {
      const { token } = generateCsrfToken({ secure: false });
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: { cookie: `vf_csrf=${token}` },
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
          cookie: "vf_csrf=token-a",
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

    it("should return false on malformed cookie instead of throwing", () => {
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: "vf_csrf=%ZZbadvalue",
          "x-csrf-token": "anything",
        },
      });
      assertEquals(validateCsrf(req), false);
    });
  });

  describe("applyCsrfCookie", () => {
    it("should set cookie on GET when absent", () => {
      const req = new Request("http://localhost/");
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      const setCookie = headers.get("set-cookie");
      assertNotEquals(setCookie, null);
      assertEquals(setCookie!.includes("vf_csrf="), true);
      assertEquals(setCookie!.includes("HttpOnly"), false); // double-submit needs JS access
      assertEquals(setCookie!.includes("Secure"), false); // http:// request
    });

    it("should set Secure flag on HTTPS requests", () => {
      const req = new Request("https://example.com/");
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      const setCookie = headers.get("set-cookie");
      assertNotEquals(setCookie, null);
      assertEquals(setCookie!.includes("Secure"), true);
    });

    it("should set Secure flag when x-forwarded-proto is https", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-forwarded-proto": "https" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      const setCookie = headers.get("set-cookie");
      assertNotEquals(setCookie, null);
      assertEquals(setCookie!.includes("Secure"), true);
    });

    it("should set cookie on HEAD when absent", () => {
      const req = new Request("http://localhost/", { method: "HEAD" });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      assertNotEquals(headers.get("set-cookie"), null);
    });

    it("should skip when cookie already present in request", () => {
      const req = new Request("http://localhost/", {
        headers: { cookie: "vf_csrf=existing-token" },
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
      const req = new Request("http://localhost/");
      const headers = new Headers();
      applyCsrfCookie(req, headers, { cookieName: "my_csrf" });

      const setCookie = headers.get("set-cookie");
      assertNotEquals(setCookie, null);
      assertEquals(setCookie!.includes("my_csrf="), true);
    });

    it("should use custom ttlSec from config object", () => {
      const req = new Request("http://localhost/");
      const headers = new Headers();
      applyCsrfCookie(req, headers, { ttlSec: 600 });

      const setCookie = headers.get("set-cookie");
      assertEquals(setCookie!.includes("Max-Age=600"), true);
    });

    it("should issue fresh token on malformed cookie instead of throwing", () => {
      const req = new Request("http://localhost/", {
        headers: { cookie: "vf_csrf=%ZZbadvalue" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, true);

      const setCookie = headers.get("set-cookie");
      assertNotEquals(setCookie, null);
      assertEquals(setCookie!.includes("vf_csrf="), true);
    });
  });
});
