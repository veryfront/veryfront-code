import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DEFAULT_HEADERS,
  DEFAULT_MAX_AGE,
  DEFAULT_METHODS,
  HTTP_FORBIDDEN,
  HTTP_NO_CONTENT,
} from "./constants.ts";

describe("CORS constants", () => {
  describe("DEFAULT_METHODS", () => {
    it("should include standard HTTP methods", () => {
      assert(DEFAULT_METHODS.includes("GET"));
      assert(DEFAULT_METHODS.includes("POST"));
      assert(DEFAULT_METHODS.includes("PUT"));
      assert(DEFAULT_METHODS.includes("PATCH"));
      assert(DEFAULT_METHODS.includes("DELETE"));
      assert(DEFAULT_METHODS.includes("OPTIONS"));
    });

    it("should have 6 methods", () => {
      assertEquals(DEFAULT_METHODS.length, 6);
    });
  });

  describe("DEFAULT_HEADERS", () => {
    it("should include Content-Type and Authorization", () => {
      assert(DEFAULT_HEADERS.includes("Content-Type"));
      assert(DEFAULT_HEADERS.includes("Authorization"));
    });
  });

  describe("DEFAULT_MAX_AGE", () => {
    it("should be 86400 seconds (24 hours)", () => {
      assertEquals(DEFAULT_MAX_AGE, 86400);
    });
  });

  describe("HTTP status codes", () => {
    it("should define HTTP_NO_CONTENT as 204", () => {
      assertEquals(HTTP_NO_CONTENT, 204);
    });

    it("should define HTTP_FORBIDDEN as 403", () => {
      assertEquals(HTTP_FORBIDDEN, 403);
    });
  });
});
