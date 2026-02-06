import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createValidationError, VeryfrontError } from "./errors.ts";

describe("security/input-validation/errors", () => {
  describe("createValidationError", () => {
    it("should create a VeryfrontError", () => {
      const error = createValidationError("test");
      assertInstanceOf(error, Error);
      assertInstanceOf(error, VeryfrontError);
    });

    it("should set message", () => {
      const error = createValidationError("Something went wrong");
      assertEquals(error.message, "Something went wrong");
    });

    it("should set slug to input-validation-failed", () => {
      const error = createValidationError("test");
      assertEquals(error.slug, "input-validation-failed");
    });

    it("should store details in context when provided", () => {
      const details = { field: "email", code: "invalid" };
      const error = createValidationError("Validation failed", details);
      assertEquals((error.context as { details: unknown }).details, details);
    });

    it("should have undefined context when no details provided", () => {
      const error = createValidationError("test");
      assertEquals(error.context, undefined);
    });

    it("should store complex details objects", () => {
      const details = {
        errors: [
          { path: "name", message: "Required" },
          { path: "email", message: "Invalid format" },
        ],
      };
      const error = createValidationError("Multiple errors", details);
      assertEquals((error.context as { details: unknown }).details, details);
    });

    it("should store primitive details", () => {
      const error = createValidationError("test", 42);
      assertEquals((error.context as { details: unknown }).details, 42);
    });

    it("should store string details", () => {
      const error = createValidationError("test", "extra info");
      assertEquals((error.context as { details: unknown }).details, "extra info");
    });

    it("should have a stack trace", () => {
      const error = createValidationError("test");
      assertEquals(typeof error.stack, "string");
    });
  });
});
