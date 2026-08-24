import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateNodeId } from "./validation.ts";

describe("workflow/dsl/validation", () => {
  describe("validateNodeId", () => {
    it("should accept valid node IDs", () => {
      validateNodeId("my-step");
      validateNodeId("step_1");
      validateNodeId("a");
    });

    it("should throw for empty or whitespace-only string", () => {
      assertThrows(() => validateNodeId(""), VeryfrontError, "non-empty");
      assertThrows(() => validateNodeId("   "), VeryfrontError, "non-empty");
      assertThrows(() => validateNodeId("\t"), VeryfrontError, "non-empty");
    });

    it("rejects surrounding whitespace", () => {
      assertThrows(() => validateNodeId(" step "), VeryfrontError, "canonical");
    });
  });
});
