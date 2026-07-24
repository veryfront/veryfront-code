import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_METHODS } from "./constants.ts";
import {
  handleCORSPreflight,
  isPreflightRequest,
  normalizeCORSPreflightList,
} from "./preflight.ts";
import { MAX_CORS_TOKEN_LENGTH } from "#veryfront/utils/cors-policy-limits.ts";

describe("security/http/cors/preflight", () => {
  describe("configured policy", () => {
    it("keeps configured methods and headers narrower than runtime capabilities", async () => {
      const request = new Request("http://localhost/", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": "Content-Type, X-Internal",
        },
      });

      const response = await handleCORSPreflight({
        request,
        config: {
          origin: "https://app.example.com",
          methods: ["GET"],
          allowedHeaders: ["Content-Type"],
        },
        allowMethods: "GET, POST",
        allowHeaders: "Content-Type, X-Internal",
      });

      assertEquals(response.headers.get("Access-Control-Allow-Methods"), "GET");
      assertEquals(response.headers.get("Access-Control-Allow-Headers"), "Content-Type");
    });

    it("uses configured header policy before request-supplied headers", async () => {
      const request = new Request("http://localhost/", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "GET",
          "access-control-request-headers": "X-Unconfigured",
        },
      });

      const response = await handleCORSPreflight({
        request,
        config: {
          origin: "https://app.example.com",
          allowedHeaders: ["Authorization"],
        },
      });

      assertEquals(response.headers.get("Access-Control-Allow-Headers"), "Authorization");
    });

    it("treats explicitly undefined optional policies as absent", async () => {
      const request = new Request("http://localhost/", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "GET",
          "access-control-request-headers": "X-Requested",
        },
      });

      const response = await handleCORSPreflight({
        request,
        config: {
          origin: "https://app.example.com",
          methods: undefined,
          allowedHeaders: undefined,
        },
      });

      assertEquals(
        response.headers.get("Access-Control-Allow-Methods"),
        DEFAULT_METHODS.join(", "),
      );
      assertEquals(response.headers.get("Access-Control-Allow-Headers"), "X-Requested");
    });

    it("omits allow headers when policy and runtime capabilities do not overlap", async () => {
      const request = new Request("http://localhost/", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "DELETE",
          "access-control-request-headers": "X-Policy",
        },
      });

      const response = await handleCORSPreflight({
        request,
        config: {
          origin: "https://app.example.com",
          methods: ["DELETE"],
          allowedHeaders: ["X-Policy"],
        },
        allowMethods: "GET, POST",
        allowHeaders: "Content-Type",
      });

      assertEquals(response.headers.get("Access-Control-Allow-Methods"), null);
      assertEquals(response.headers.get("Access-Control-Allow-Headers"), null);
    });

    it("fails closed instead of emitting an oversized configured header list", async () => {
      const request = new Request("http://localhost/", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "GET",
        },
      });

      const response = await handleCORSPreflight({
        request,
        config: {
          origin: "https://app.example.com",
          allowedHeaders: ["X".repeat(MAX_CORS_TOKEN_LENGTH + 1)],
        },
      });

      assertEquals(response.status, 403);
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
      assertEquals(response.headers.get("Access-Control-Allow-Headers"), null);
      assertEquals(response.headers.get("Access-Control-Max-Age"), null);
    });

    it("rejects malformed and unknown configuration without partial CORS headers", async () => {
      const request = new Request("http://localhost/", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "GET",
        },
      });

      for (
        const config of [
          { origin: "https://app.example.com", credentials: "true" },
          { origin: "https://app.example.com", maxAge: Number.NaN },
          { origin: "https://app.example.com", methods: ["GET, POST"] },
          { origin: "https://app.example.com", unknown: true },
        ]
      ) {
        const response = await handleCORSPreflight({
          request,
          config: config as never,
        });

        assertEquals(response.status, 403);
        assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
        assertEquals(response.headers.get("Access-Control-Allow-Methods"), null);
        assertEquals(response.headers.get("Access-Control-Allow-Headers"), null);
        assertEquals(response.headers.get("Access-Control-Max-Age"), null);
      }
    });

    it("emits max age only for allowed origins and valid safe integers", async () => {
      const request = new Request("http://localhost/", {
        method: "OPTIONS",
        headers: {
          origin: "https://denied.example.com",
          "access-control-request-method": "GET",
        },
      });

      const denied = await handleCORSPreflight({
        request,
        config: {
          origin: "https://allowed.example.com",
          maxAge: 7,
        },
      });

      assertEquals(denied.status, 403);
      assertEquals(denied.headers.get("Access-Control-Max-Age"), null);
    });

    it("normalizes unknown non-string capability inputs without throwing", () => {
      for (const value of [undefined, null, 42, {}, Symbol("methods")]) {
        assertEquals(normalizeCORSPreflightList(value as never), null);
      }
    });

    it("fails closed for hostile, malformed, and oversized capability values", () => {
      const revoked = Proxy.revocable(["GET"], {});
      revoked.revoke();

      for (
        const value of [
          revoked.proxy,
          "GET\r\nX-Injected",
          "M\u{100}",
          "G".repeat(100_000),
        ]
      ) {
        assertEquals(normalizeCORSPreflightList(value as never), null);
      }
    });

    it("returns one fixed bounded rejection for hostile option names and proxies", async () => {
      const request = new Request("http://localhost/", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "GET",
        },
      });
      const revokedConfig = Proxy.revocable({}, {});
      const revokedOrigins = Proxy.revocable(["https://app.example.com"], {});
      revokedConfig.revoke();
      revokedOrigins.revoke();

      for (
        const config of [
          revokedConfig.proxy,
          { origin: revokedOrigins.proxy },
          { ["unknown\r\nX-Injected: yes"]: true },
          { ["non-byte-\u{100}"]: true },
          { ["x".repeat(100_000)]: true },
        ]
      ) {
        const response = await handleCORSPreflight({
          request,
          config: config as never,
        });

        assertEquals(response.status, 403);
        assertEquals(response.headers.get("X-CORS-Error"), "CORS policy rejected");
        assertEquals(await response.text(), "CORS request rejected");
      }
    });
  });

  describe("isPreflightRequest", () => {
    it("should return true for OPTIONS with access-control-request-method", () => {
      const req = new Request("http://localhost/", {
        method: "OPTIONS",
        headers: { "Access-Control-Request-Method": "POST" },
      });

      assertEquals(isPreflightRequest(req), true);
    });

    it("should return true for OPTIONS with access-control-request-headers", () => {
      const req = new Request("http://localhost/", {
        method: "OPTIONS",
        headers: { "Access-Control-Request-Headers": "Content-Type" },
      });

      assertEquals(isPreflightRequest(req), true);
    });

    it("should return false for non-OPTIONS requests", () => {
      const req = new Request("http://localhost/", {
        method: "GET",
        headers: { "Access-Control-Request-Method": "POST" },
      });

      assertEquals(isPreflightRequest(req), false);
    });

    it("should return false for plain OPTIONS without CORS headers", () => {
      const req = new Request("http://localhost/", { method: "OPTIONS" });

      assertEquals(isPreflightRequest(req), false);
    });
  });
});
