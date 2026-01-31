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
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
        assert(DEFAULT_METHODS.includes(method));
      }
    });

    it("should have 6 methods", () => {
      assertEquals(DEFAULT_METHODS.length, 6);
    });
  });

  describe("DEFAULT_HEADERS", () => {
    it("should include Content-Type and Authorization", () => {
      for (const header of ["Content-Type", "Authorization"]) {
        assert(DEFAULT_HEADERS.includes(header));
      }
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
