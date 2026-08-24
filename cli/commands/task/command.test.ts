import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseTaskConfig, taskDiscoverySourceLabel } from "./command.ts";

describe("commands/task/command", () => {
  it("accepts only JSON objects for --config", () => {
    assertEquals(parseTaskConfig('{"limit":3}'), { limit: 3 });
    assertEquals(parseTaskConfig(undefined), {});

    for (const value of ["null", "[]", '"scalar"', "42", "true"]) {
      assertThrows(
        () => parseTaskConfig(value),
        Error,
        "Invalid --config JSON: must be a valid JSON object",
      );
    }
  });

  it("describes local discovery without exposing the project path", () => {
    assertEquals(taskDiscoverySourceLabel(undefined), "tasks/...");
    assertEquals(taskDiscoverySourceLabel({}), "main");
    assertEquals(taskDiscoverySourceLabel({ branchRef: "feature-x" }), "branch feature-x");
  });
});
