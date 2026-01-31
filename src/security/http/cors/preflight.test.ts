import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isPreflightRequest } from "./preflight.ts";

describe("security/http/cors/preflight", () => {
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
