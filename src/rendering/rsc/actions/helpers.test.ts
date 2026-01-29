import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateCsrfToken, getSessionFromJwt, validateCsrf } from "./helpers.ts";

describe("rendering/rsc/actions/helpers", () => {
  describe("generateCsrfToken", () => {
    it("should generate a token and Set-Cookie header", () => {
      const { token, setCookie } = generateCsrfToken();
      assertEquals(typeof token, "string");
      assertEquals(token.length > 0, true);
      assertEquals(setCookie.includes("vf_csrf="), true);
      assertEquals(setCookie.includes("HttpOnly"), true);
      assertEquals(setCookie.includes("SameSite=Lax"), true);
    });

    it("should use custom cookie name", () => {
      const { setCookie } = generateCsrfToken({ cookieName: "my_csrf" });
      assertEquals(setCookie.includes("my_csrf="), true);
    });

    it("should use custom ttl", () => {
      const { setCookie } = generateCsrfToken({ ttlSec: 3600 });
      assertEquals(setCookie.includes("Max-Age=3600"), true);
    });

    it("should generate unique tokens", () => {
      const a = generateCsrfToken().token;
      const b = generateCsrfToken().token;
      assertEquals(a !== b, true);
    });
  });

  describe("validateCsrf", () => {
    it("should return false when no cookie present", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-csrf-token": "abc" },
      });
      assertEquals(validateCsrf(req), false);
    });

    it("should return false when cookie and header differ", () => {
      const req = new Request("http://localhost/", {
        headers: {
          cookie: "vf_csrf=token1",
          "x-csrf-token": "token2",
        },
      });
      assertEquals(validateCsrf(req), false);
    });

    it("should return true when cookie and header match", () => {
      const req = new Request("http://localhost/", {
        headers: {
          cookie: "vf_csrf=matching_token",
          "x-csrf-token": "matching_token",
        },
      });
      assertEquals(validateCsrf(req), true);
    });

    it("should support custom cookie and header names", () => {
      const req = new Request("http://localhost/", {
        headers: {
          cookie: "custom_csrf=tok123",
          "x-custom-csrf": "tok123",
        },
      });
      assertEquals(
        validateCsrf(req, { cookieName: "custom_csrf", headerName: "x-custom-csrf" }),
        true,
      );
    });
  });

  describe("getSessionFromJwt", () => {
    it("should return null when no cookie present", () => {
      const req = new Request("http://localhost/");
      assertEquals(getSessionFromJwt(req), null);
    });

    it("should return null for non-JWT token", () => {
      const req = new Request("http://localhost/", {
        headers: { cookie: "session=not-a-jwt" },
      });
      assertEquals(getSessionFromJwt(req), null);
    });

    it("should decode a JWT payload", () => {
      const payload = { sub: "user123", role: "admin" };
      const encodedPayload = btoa(JSON.stringify(payload));
      const jwt = `header.${encodedPayload}.signature`;
      const req = new Request("http://localhost/", {
        headers: { cookie: `session=${jwt}` },
      });
      const result = getSessionFromJwt(req);
      assertEquals(result?.sub, "user123");
      assertEquals(result?.role, "admin");
    });

    it("should use custom cookie name", () => {
      const payload = { id: 1 };
      const encodedPayload = btoa(JSON.stringify(payload));
      const jwt = `h.${encodedPayload}.s`;
      const req = new Request("http://localhost/", {
        headers: { cookie: `auth=${jwt}` },
      });
      assertEquals(getSessionFromJwt(req, { cookieName: "auth" })?.id, 1);
    });

    it("should return null for invalid base64 payload", () => {
      const req = new Request("http://localhost/", {
        headers: { cookie: "session=a.!!!invalid!!!.b" },
      });
      assertEquals(getSessionFromJwt(req), null);
    });
  });
});
