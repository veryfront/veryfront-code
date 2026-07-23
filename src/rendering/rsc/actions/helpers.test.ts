import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { base64urlEncode } from "#veryfront/utils/base64url.ts";
import { decodeUnverifiedJwtClaims, generateCsrfToken, validateCsrf } from "./helpers.ts";
import * as publicActions from "./index.ts";

describe("rendering/rsc/actions/helpers", () => {
  describe("generateCsrfToken", () => {
    it("should generate a token and Set-Cookie header", () => {
      const { token, setCookie } = generateCsrfToken();
      assertEquals(typeof token, "string");
      assertEquals(token.length > 0, true);
      assertEquals(setCookie.startsWith("__Host-vf_csrf="), true);
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
          cookie: "__Host-vf_csrf=token1",
          "x-csrf-token": "token2",
        },
      });
      assertEquals(validateCsrf(req), false);
    });

    it("should return true when cookie and header match", () => {
      const { token } = generateCsrfToken();
      const req = new Request("http://localhost/", {
        headers: {
          cookie: `__Host-vf_csrf=${token}`,
          "x-csrf-token": token,
        },
      });
      assertEquals(validateCsrf(req), true);
    });

    it("should support custom cookie and header names", () => {
      const { token } = generateCsrfToken();
      const req = new Request("http://localhost/", {
        headers: {
          cookie: `custom_csrf=${token}`,
          "x-custom-csrf": token,
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

    it("decodes real base64url-encoded payloads (RFC 7515, not standard base64)", () => {
      // Real JWTs are base64url: `+`/`/` become `-`/`_`, padding stripped.
      // Pick a payload whose JSON produces all three transform characters so
      // the test fails if the decoder skips any of them.
      const payload = { iss: "realm?a>b", sub: "user+name/role=admin" };
      const encoded = base64urlEncode(JSON.stringify(payload));
      assertEquals(
        /[+/=]/.test(encoded),
        false,
        "base64urlEncode output must not contain standard-base64 chars",
      );

      const jwt = `header.${encoded}.signature`;
      const req = new Request("http://localhost/", {
        headers: { cookie: `session=${jwt}` },
      });
      const result = decodeUnverifiedJwtClaims(req);
      assertEquals(result?.iss, "realm?a>b");
      assertEquals(result?.sub, "user+name/role=admin");
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
  });
});
