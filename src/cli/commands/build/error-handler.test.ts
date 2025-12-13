import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists, assertRejects } from "std/assert/mod.ts";
import { handleBuildError } from "./error-handler.ts";

describe("error-handler", () => {
  describe("handleBuildError", () => {
    it("should export handleBuildError function", () => {
      assertExists(handleBuildError);
      assertEquals(typeof handleBuildError, "function");
    });

    it("should handle Error instances", async () => {
      const error = new Error("Test error");

      await assertRejects(
        async () => {
          handleBuildError(error);
        },
        Error,
        "Test error"
      );
    });

    it("should handle non-Error values", async () => {
      const error = "String error";

      await assertRejects(
        async () => {
          handleBuildError(error);
        }
      );
    });

    it("should handle Error with stack trace", async () => {
      const error = new Error("Test error with stack");
      error.stack = "Error: Test error with stack\n    at foo\n    at bar\n    at baz";

      await assertRejects(
        async () => {
          handleBuildError(error);
        },
        Error,
        "Test error with stack"
      );
    });
  });
});
