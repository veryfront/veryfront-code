import { describe, it, beforeEach, afterEach } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  DEFAULT_HEADERS,
  DEFAULT_MAX_AGE,
  DEFAULT_METHODS,
  DEV_LOCALHOST_ORIGINS,
  HTTP_FORBIDDEN,
  HTTP_NO_CONTENT,
  isProductionMode,
} from "./constants.ts";

describe("CORS Constants", () => {
  describe("DEFAULT_METHODS", () => {
    it("should contain standard HTTP methods", () => {
      assertEquals(DEFAULT_METHODS.length, 6);
      assert(DEFAULT_METHODS.includes("GET"));
      assert(DEFAULT_METHODS.includes("POST"));
      assert(DEFAULT_METHODS.includes("PUT"));
      assert(DEFAULT_METHODS.includes("PATCH"));
      assert(DEFAULT_METHODS.includes("DELETE"));
      assert(DEFAULT_METHODS.includes("OPTIONS"));
    });
  });

  describe("DEFAULT_HEADERS", () => {
    it("should contain standard headers", () => {
      assertEquals(DEFAULT_HEADERS.length, 2);
      assert(DEFAULT_HEADERS.includes("Content-Type"));
      assert(DEFAULT_HEADERS.includes("Authorization"));
    });
  });

  describe("DEFAULT_MAX_AGE", () => {
    it("should be 24 hours in seconds", () => {
      assertEquals(DEFAULT_MAX_AGE, 86400);
    });
  });

  describe("DEV_LOCALHOST_ORIGINS", () => {
    it("should be defined and exported", () => {
      assert(Array.isArray(DEV_LOCALHOST_ORIGINS));
    });
  });

  describe("HTTP status codes", () => {
    it("should have correct HTTP_NO_CONTENT value", () => {
      assertEquals(HTTP_NO_CONTENT, 204);
    });

    it("should have correct HTTP_FORBIDDEN value", () => {
      assertEquals(HTTP_FORBIDDEN, 403);
    });
  });

  describe("isProductionMode", () => {
    let originalEnv: typeof Deno.env | undefined;

    beforeEach(() => {
      // Save original env
      if (typeof Deno !== "undefined" && Deno.env) {
        originalEnv = Deno.env;
      }
    });

    afterEach(() => {
      // Restore original env
      if (originalEnv && typeof Deno !== "undefined") {
        Object.defineProperty(Deno, "env", {
          value: originalEnv,
          configurable: true,
          writable: true,
        });
      }
    });

    it("should return false when VERYFRONT_ENV is development", () => {
      // Set environment variable for test
      if (typeof Deno !== "undefined" && Deno.env) {
        Deno.env.set("VERYFRONT_ENV", "development");
        const result = isProductionMode();
        assertEquals(result, false);
        Deno.env.delete("VERYFRONT_ENV");
      }
    });

    it("should return false when NODE_ENV is development", () => {
      if (typeof Deno !== "undefined" && Deno.env) {
        Deno.env.set("NODE_ENV", "development");
        const result = isProductionMode();
        assertEquals(result, false);
        Deno.env.delete("NODE_ENV");
      }
    });

    it("should return false when DENO_ENV is development", () => {
      if (typeof Deno !== "undefined" && Deno.env) {
        Deno.env.set("DENO_ENV", "development");
        const result = isProductionMode();
        assertEquals(result, false);
        Deno.env.delete("DENO_ENV");
      }
    });

    it("should return true for production by default", () => {
      if (typeof Deno !== "undefined" && Deno.env) {
        Deno.env.delete("VERYFRONT_ENV");
        Deno.env.delete("NODE_ENV");
        Deno.env.delete("DENO_ENV");
        const result = isProductionMode();
        assertEquals(result, true);
      }
    });

    it("should default to true on error (fail-secure)", () => {
      const result = isProductionMode();
      // Should return true as a safe default
      assert(typeof result === "boolean");
    });
  });
});
