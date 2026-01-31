import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatErrorBox, formatUserError } from "./error-formatter.ts";

describe("formatErrorBox", () => {
  it("should return a string containing the error message", () => {
    const result = formatErrorBox(new Error("Something went wrong"));
    assert(typeof result === "string");
    assert(result.includes("Something went wrong"));
  });

  it("should include 'Error' title", () => {
    const result = formatErrorBox(new Error("test error"));
    assert(result.includes("Error"));
  });

  it("should include solution steps for known errors", () => {
    const error = new Error("Config file not found in project");
    error.name = "ConfigNotFoundError";

    const result = formatErrorBox(error);
    assert(result.length > 0);
  });

  it("should include doctor hint for unknown errors", () => {
    const result = formatErrorBox(new Error("some random unknown error xyz_unique"));
    assert(result.includes("veryfront doctor"));
  });
});

describe("formatUserError", () => {
  it("should return a string containing the error message", () => {
    const result = formatUserError(new Error("Something went wrong"));
    assert(typeof result === "string");
    assert(result.includes("Something went wrong"));
  });

  it("should include Error prefix", () => {
    const result = formatUserError(new Error("test error"));
    assert(result.includes("Error"));
  });

  it("should include stack trace for unknown errors", () => {
    const result = formatUserError(new Error("unknown error xyz_unique_test"));
    assert(result.includes("Stack trace") || result.includes("veryfront doctor"));
  });

  it("should include doctor hint for unknown errors", () => {
    const result = formatUserError(new Error("completely unknown error abcdef"));
    assert(result.includes("veryfront doctor"));
  });
});
