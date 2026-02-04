/**
 * Tests for build error handler
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleBuildError } from "./error-handler.ts";

describe("build/error-handler", () => {
  describe("handleBuildError", () => {
    it("is a function", () => {
      assertEquals(typeof handleBuildError, "function");
    });

    it("throws Error objects back after logging", () => {
      const error = new Error("Test build error");

      assertThrows(
        () => handleBuildError(error),
        Error,
        "Test build error",
      );
    });

    it("throws non-Error values back after logging", () => {
      let threw = false;
      let thrownValue: unknown;

      try {
        handleBuildError("string error");
      } catch (e) {
        threw = true;
        thrownValue = e;
      }

      assertEquals(threw, true);
      assertEquals(thrownValue, "string error");
    });
  });
});
