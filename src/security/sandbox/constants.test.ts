import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import {
  DEFAULT_RATE_LIMIT_REQUESTS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_NO_CONTENT,
  HTTP_STATUS_TOO_MANY_REQUESTS,
} from "./constants.ts";

describe("Sandbox Constants", () => {
  describe("HTTP Status Codes", () => {
    it("should have correct HTTP_STATUS_NO_CONTENT", () => {
      assertEquals(HTTP_STATUS_NO_CONTENT, 204);
    });

    it("should have correct HTTP_STATUS_FORBIDDEN", () => {
      assertEquals(HTTP_STATUS_FORBIDDEN, 403);
    });

    it("should have correct HTTP_STATUS_TOO_MANY_REQUESTS", () => {
      assertEquals(HTTP_STATUS_TOO_MANY_REQUESTS, 429);
    });
  });

  describe("Rate Limit Defaults", () => {
    it("should have DEFAULT_RATE_LIMIT_REQUESTS set to 100", () => {
      assertEquals(DEFAULT_RATE_LIMIT_REQUESTS, 100);
    });

    it("should have DEFAULT_RATE_LIMIT_WINDOW_MS set to 60 seconds", () => {
      assertEquals(DEFAULT_RATE_LIMIT_WINDOW_MS, 60_000);
    });
  });

  describe("Sandbox Timeout", () => {
    it("should have DEFAULT_SANDBOX_TIMEOUT_MS set to 5 seconds", () => {
      assertEquals(DEFAULT_SANDBOX_TIMEOUT_MS, 5000);
    });
  });
});
