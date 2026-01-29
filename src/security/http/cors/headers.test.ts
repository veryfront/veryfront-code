import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { shouldApplyCORS } from "./headers.ts";

describe("security/http/cors/headers", () => {
  describe("shouldApplyCORS", () => {
    it("should return false when config is falsy", () => {
      const req = new Request("http://localhost/");
      assertEquals(shouldApplyCORS(req, undefined), false);
      assertEquals(shouldApplyCORS(req, false), false);
    });

    it("should return true when config is true", () => {
      const req = new Request("http://localhost/");
      assertEquals(shouldApplyCORS(req, true), true);
    });

    it("should return true when request has Origin header", () => {
      const req = new Request("http://localhost/", {
        headers: { Origin: "http://example.com" },
      });
      assertEquals(shouldApplyCORS(req, { origin: "http://example.com" }), true);
    });

    it("should return true for wildcard origin without Origin header", () => {
      const req = new Request("http://localhost/");
      assertEquals(shouldApplyCORS(req, { origin: "*" }), true);
    });

    it("should return false for specific origin without Origin header", () => {
      const req = new Request("http://localhost/");
      assertEquals(shouldApplyCORS(req, { origin: "http://example.com" }), false);
    });
  });
});
