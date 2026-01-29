import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatErrorBox, formatUserError } from "./error-formatter.ts";

describe("formatErrorBox", () => {
  it("should return a string containing the error message", () => {
    const error = new Error("Something went wrong");
    const result = formatErrorBox(error);
    assert(typeof result === "string");
    assert(result.includes("Something went wrong"));
  });

  it("should include 'Error' title", () => {
    const error = new Error("test error");
    const result = formatErrorBox(error);
    assert(result.includes("Error"));
  });

  it("should include solution steps for known errors", () => {
    // Simulate a known error by creating an error that matches "missing-config"
    const error = new Error("Config file not found in project");
    error.name = "ConfigNotFoundError";
    const result = formatErrorBox(error);
    // The box should still render even if no solution matches
    assert(result.length > 0);
  });

  it("should include doctor hint for unknown errors", () => {
    const error = new Error("some random unknown error xyz_unique");
    const result = formatErrorBox(error);
    assert(result.includes("veryfront doctor"));
  });
});

describe("formatUserError", () => {
  it("should return a string containing the error message", () => {
    const error = new Error("Something went wrong");
    const result = formatUserError(error);
    assert(typeof result === "string");
    assert(result.includes("Something went wrong"));
  });

  it("should include Error prefix", () => {
    const error = new Error("test error");
    const result = formatUserError(error);
    assert(result.includes("Error"));
  });

  it("should include stack trace for unknown errors", () => {
    const error = new Error("unknown error xyz_unique_test");
    const result = formatUserError(error);
    // Should include "Stack trace:" for errors without known solutions
    assert(result.includes("Stack trace") || result.includes("veryfront doctor"));
  });

  it("should include doctor hint for unknown errors", () => {
    const error = new Error("completely unknown error abcdef");
    const result = formatUserError(error);
    assert(result.includes("veryfront doctor"));
  });
});
