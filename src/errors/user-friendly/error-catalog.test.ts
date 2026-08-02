import "#veryfront/schemas/_test-setup.ts";
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
      const steps = solution.steps;
      if (steps === undefined) continue;

      assert(Array.isArray(steps), `${key} steps should be an array`);
      assert(steps.length > 0, `${key} steps should not be empty`);

      for (const step of steps) {
        assert(typeof step === "string" && step.length > 0, `${key} has empty step`);
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

    it("should list supported files without claiming init creates one", () => {
      const sol = ERROR_SOLUTIONS["missing-config"];
      assertExists(sol);
      const guidance = JSON.stringify(sol).toLowerCase();

      assert(guidance.includes("veryfront.config.js"));
      assert(guidance.includes("veryfront.config.ts"));
      assert(guidance.includes("veryfront.config.mjs"));
      assertEquals(guidance.includes("veryfront init"), false);
      assertEquals(guidance.includes("vf init"), false);
    });
  });

  describe("invalid-config", () => {
    it("should not describe legal trailing commas as invalid", () => {
      const sol = ERROR_SOLUTIONS["invalid-config"];
      assertExists(sol);
      const guidance = JSON.stringify(sol).toLowerCase();

      assertEquals(guidance.includes("remove any trailing comma"), false);
      assert(guidance.includes("trailing commas are valid"));
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
      assertEquals(
        sol.docs,
        "https://veryfront.com/docs/errors/client-boundary-violation",
      );
    });
  });

  it("should expose immutable solution definitions", () => {
    const missingConfig = ERROR_SOLUTIONS["missing-config"];
    assertExists(missingConfig);
    assertExists(missingConfig.steps);

    assertEquals(Object.isFrozen(ERROR_SOLUTIONS), true);
    assertEquals(Object.isFrozen(missingConfig), true);
    assertEquals(Object.isFrozen(missingConfig.steps), true);
  });
});
