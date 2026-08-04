import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  HOST_PROJECT_EXECUTION_OVERRIDE_ENV,
  isHostProjectExecutionOverrideEnabled,
} from "./host-execution-policy.ts";

describe("security/host-execution-policy operator override", () => {
  it("names the operator-owned environment variable", () => {
    assertEquals(
      HOST_PROJECT_EXECUTION_OVERRIDE_ENV,
      "VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION",
      "the override name is operator-facing and must stay stable",
    );
  });

  it("denies execution when the override is absent", () => {
    assertEquals(
      isHostProjectExecutionOverrideEnabled(undefined),
      false,
      "an unset override must leave the shared runtime denied",
    );
  });

  it("grants execution for accepted affirmative values", () => {
    for (const value of ["1", "true", "yes", "on", " TRUE ", "On"]) {
      assertEquals(
        isHostProjectExecutionOverrideEnabled(value),
        true,
        `"${value}" should grant host project execution`,
      );
    }
  });

  it("fails closed for negative, empty, and unrecognized values", () => {
    for (const value of ["", " ", "0", "false", "no", "off", "maybe", "2", "enabled"]) {
      assertEquals(
        isHostProjectExecutionOverrideEnabled(value),
        false,
        `"${value}" must not grant host project execution`,
      );
    }
  });
});
