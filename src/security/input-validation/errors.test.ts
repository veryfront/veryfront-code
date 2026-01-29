import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ValidationError } from "./errors.ts";

describe("security/input-validation/errors", () => {
  describe("ValidationError", () => {
    it("should extend Error", () => {
      const error = new ValidationError("test");
      assertInstanceOf(error, Error);
      assertInstanceOf(error, ValidationError);
    });

    it("should set message", () => {
      const error = new ValidationError("Something went wrong");
      assertEquals(error.message, "Something went wrong");
    });

    it("should set name to ValidationError", () => {
      const error = new ValidationError("test");
      assertEquals(error.name, "ValidationError");
    });

    it("should store details when provided", () => {
      const details = { field: "email", code: "invalid" };
      const error = new ValidationError("Validation failed", details);
      assertEquals(error.details, details);
    });

    it("should have undefined details when not provided", () => {
      const error = new ValidationError("test");
      assertEquals(error.details, undefined);
    });

    it("should store complex details objects", () => {
      const details = {
        errors: [
          { path: "name", message: "Required" },
          { path: "email", message: "Invalid format" },
        ],
      };
      const error = new ValidationError("Multiple errors", details);
      assertEquals(error.details, details);
    });

    it("should store primitive details", () => {
      const error = new ValidationError("test", 42);
      assertEquals(error.details, 42);
    });

    it("should store string details", () => {
      const error = new ValidationError("test", "extra info");
      assertEquals(error.details, "extra info");
    });

    it("should store null details", () => {
      const error = new ValidationError("test", null);
      assertEquals(error.details, null);
    });

    it("should have a stack trace", () => {
      const error = new ValidationError("test");
      assertEquals(typeof error.stack, "string");
    });
  });
});
