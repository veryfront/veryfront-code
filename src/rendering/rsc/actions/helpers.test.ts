import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { decodeUnverifiedJwtClaims, generateCsrfToken, validateCsrf } from "./helpers.ts";
import * as publicActions from "./index.ts";

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
      const { token: a } = generateCsrfToken();
      const { token: b } = generateCsrfToken();
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
        validateCsrf(req, {
          cookieName: "custom_csrf",
          headerName: "x-custom-csrf",
        }),
        true,
      );
    });
  });

  describe("decodeUnverifiedJwtClaims (DANGEROUS — does not verify signature)", () => {
    it("should return null when no cookie present", () => {
      const req = new Request("http://localhost/");
      assertEquals(decodeUnverifiedJwtClaims(req), null);
    });

    it("should return null for non-JWT token", () => {
      const req = new Request("http://localhost/", {
        headers: { cookie: "session=not-a-jwt" },
      });
      assertEquals(decodeUnverifiedJwtClaims(req), null);
    });

    it("should decode a JWT payload without verifying signature", () => {
      const payload = { sub: "user123", role: "admin" };
      const jwt = `header.${btoa(JSON.stringify(payload))}.signature`;
      const req = new Request("http://localhost/", {
        headers: { cookie: `session=${jwt}` },
      });

      const result = decodeUnverifiedJwtClaims(req);
      assertEquals(result?.sub, "user123");
      assertEquals(result?.role, "admin");
    });

    it("should use custom cookie name", () => {
      const payload = { id: 1 };
      const jwt = `h.${btoa(JSON.stringify(payload))}.s`;
      const req = new Request("http://localhost/", {
        headers: { cookie: `auth=${jwt}` },
      });

      assertEquals(decodeUnverifiedJwtClaims(req, { cookieName: "auth" })?.id, 1);
    });

    it("should return null for invalid base64 payload", () => {
      const req = new Request("http://localhost/", {
        headers: { cookie: "session=a.!!!invalid!!!.b" },
      });
      assertEquals(decodeUnverifiedJwtClaims(req), null);
    });

    it(
      "DOES NOT reject a forged/unsigned token — this documents that the helper is UNSAFE for auth",
      () => {
        // An attacker can craft this cookie with no signing key at all.
        const fake = btoa(JSON.stringify({ sub: "victim", role: "admin" }));
        const forged = `x.${fake}.x`;
        const req = new Request("http://localhost/", {
          headers: { cookie: `session=${forged}` },
        });

        // The helper returns the attacker-controlled claims — by design. This is
        // exactly why it must NOT be used for authentication or authorization.
        const result = decodeUnverifiedJwtClaims(req);
        assertEquals(result?.sub, "victim");
        assertEquals(result?.role, "admin");
      },
    );
  });

  describe("public RSC actions surface", () => {
    it("does NOT export getSessionFromJwt", () => {
      assertEquals(
        (publicActions as Record<string, unknown>).getSessionFromJwt,
        undefined,
      );
    });

    it("does NOT export decodeUnverifiedJwtClaims (kept internal)", () => {
      assertEquals(
        (publicActions as Record<string, unknown>).decodeUnverifiedJwtClaims,
        undefined,
      );
    });

    it("exports verifySessionJwt", () => {
      assertEquals(
        typeof (publicActions as Record<string, unknown>).verifySessionJwt,
        "function",
      );
    });
  });
});
