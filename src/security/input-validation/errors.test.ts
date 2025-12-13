import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { ValidationError } from "./errors.ts";

describe("ValidationError", () => {
  it("should create error with message", () => {
    const error = new ValidationError("Invalid input");
    assertExists(error);
    assertEquals(error.message, "Invalid input");
    assertEquals(error.name, "ValidationError");
  });

  it("should be instance of Error", () => {
    const error = new ValidationError("Test error");
    assertEquals(error instanceof Error, true);
    assertEquals(error instanceof ValidationError, true);
  });

  it("should store details when provided", () => {
    const details = { field: "email", reason: "invalid format" };
    const error = new ValidationError("Validation failed", details);
    assertEquals(error.details, details);
  });

  it("should work without details", () => {
    const error = new ValidationError("Simple error");
    assertEquals(error.details, undefined);
  });

  it("should support complex details", () => {
    const details = {
      fields: ["email", "password"],
      errors: ["required", "too short"],
      metadata: { timestamp: Date.now() },
    };
    const error = new ValidationError("Multiple validation errors", details);
    assertEquals(error.details, details);
  });

  it("should have correct error name", () => {
    const error = new ValidationError("Test");
    assertEquals(error.name, "ValidationError");
  });

  it("should be throwable and catchable", () => {
    try {
      throw new ValidationError("Test error", { code: 123 });
    } catch (error) {
      assertEquals(error instanceof ValidationError, true);
      if (error instanceof ValidationError) {
        assertEquals(error.message, "Test error");
        assertEquals(error.details, { code: 123 });
      }
    }
  });
});
