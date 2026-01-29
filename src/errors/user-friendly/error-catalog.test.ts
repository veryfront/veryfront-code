import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ERROR_SOLUTIONS } from "./error-catalog.ts";

describe("ERROR_SOLUTIONS", () => {
  it("should be a non-empty record", () => {
    assertEquals(typeof ERROR_SOLUTIONS, "object");
    assert(Object.keys(ERROR_SOLUTIONS).length > 0);
  });

  it("should contain all expected error keys", () => {
    const expectedKeys = [
      "missing-config",
      "invalid-config",
      "invalid-route",
      "client-boundary",
      "import-not-found",
      "port-in-use",
      "build-failed",
      "missing-deps",
    ];

    for (const key of expectedKeys) {
      assert(key in ERROR_SOLUTIONS, `Missing key: ${key}`);
    }
  });

  it("should have message for every error solution", () => {
    for (const [key, solution] of Object.entries(ERROR_SOLUTIONS)) {
      assert(
        typeof solution.message === "string" && solution.message.length > 0,
        `${key} should have a non-empty message`,
      );
    }
  });

  it("should have steps arrays when present", () => {
    for (const [key, solution] of Object.entries(ERROR_SOLUTIONS)) {
      if (solution.steps !== undefined) {
        assert(Array.isArray(solution.steps), `${key} steps should be an array`);
        assert(solution.steps.length > 0, `${key} steps should not be empty`);
        for (const step of solution.steps) {
          assert(typeof step === "string" && step.length > 0, `${key} has empty step`);
        }
      }
    }
  });

  describe("missing-config", () => {
    it("should have steps and an example", () => {
      const sol = ERROR_SOLUTIONS["missing-config"];
      assertExists(sol);
      assertExists(sol.steps);
      assert(sol.steps.length >= 2);
      assertExists(sol.example);
      assert(sol.example.includes("export default"));
    });
  });

  describe("port-in-use", () => {
    it("should mention port in message", () => {
      const sol = ERROR_SOLUTIONS["port-in-use"];
      assertExists(sol);
      assert(sol.message.toLowerCase().includes("port"));
    });

    it("should have an example with --port flag", () => {
      const sol = ERROR_SOLUTIONS["port-in-use"];
      assertExists(sol);
      assertExists(sol.example);
      assert(sol.example.includes("--port"));
    });
  });

  describe("client-boundary", () => {
    it("should reference docs URL", () => {
      const sol = ERROR_SOLUTIONS["client-boundary"];
      assertExists(sol);
      assertExists(sol.docs);
      assert(sol.docs.includes("rsc-boundaries"));
    });
  });
});
