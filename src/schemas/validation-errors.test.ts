import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  formatSchemaValidationErrors,
  MAX_SCHEMA_VALIDATION_ERRORS,
  readSchemaValidationErrors,
  toSchemaValidationErrors,
} from "./validation-errors.ts";

describe("schemas/validation-errors", () => {
  it("reports issue paths as JSON Pointers, escaping ~ and /", () => {
    assertEquals(
      toSchemaValidationErrors([
        { path: [], message: "Expected object" },
        { path: ["items", 0, "a/b~c"], message: "Required" },
      ]),
      [
        { path: "", message: "Expected object" },
        { path: "/items/0/a~1b~0c", message: "Required" },
      ],
    );
  });

  it("keeps at most the maximum number of errors", () => {
    const issues = Array.from(
      { length: MAX_SCHEMA_VALIDATION_ERRORS + 5 },
      (_, index) => ({ path: [index], message: "Invalid" }),
    );
    assertEquals(toSchemaValidationErrors(issues).length, MAX_SCHEMA_VALIDATION_ERRORS);
  });

  it("formats errors on one line, naming the root", () => {
    assertEquals(
      formatSchemaValidationErrors([
        { path: "", message: "Expected object" },
        { path: "/amount", message: "Expected number" },
      ]),
      "<root>: Expected object; /amount: Expected number",
    );
  });

  it("reads back only a list of path and message entries", () => {
    const errors = [{ path: "/amount", message: "Expected number" }];
    assertEquals(readSchemaValidationErrors(errors), errors);
    assertEquals(readSchemaValidationErrors([]), []);
    assertEquals(readSchemaValidationErrors(undefined), undefined);
    assertEquals(readSchemaValidationErrors({ path: "", message: "x" }), undefined);
    assertEquals(readSchemaValidationErrors([null]), undefined);
    assertEquals(readSchemaValidationErrors([{ path: 1, message: "x" }]), undefined);
    assertEquals(readSchemaValidationErrors([{ path: "", message: 1 }]), undefined);
  });
});
