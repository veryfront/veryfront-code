import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import {
  HOST_PROJECT_EXECUTION_OVERRIDE_ENV,
  isHostProjectExecutionOverrideConfigured,
  resolveHostProjectExecutionPosture,
} from "./host-execution-policy.ts";

describe("security/host-execution-policy operator override", () => {
  it("treats the deprecated override as ignored in every runtime topology", () => {
    assertEquals(
      resolveHostProjectExecutionPosture({ sharedRuntime: true, overrideConfigured: true }),
      { allowHostProjectCodeExecution: false, overrideIgnored: true },
    );
    assertEquals(
      resolveHostProjectExecutionPosture({ sharedRuntime: false, overrideConfigured: true }),
      { allowHostProjectCodeExecution: true, overrideIgnored: true },
    );
    assertEquals(
      resolveHostProjectExecutionPosture({ sharedRuntime: false, overrideConfigured: false }),
      { allowHostProjectCodeExecution: true, overrideIgnored: false },
    );
  });

  it("names the operator-owned environment variable", () => {
    assertEquals(
      HOST_PROJECT_EXECUTION_OVERRIDE_ENV,
      "VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION",
      "the override name is operator-facing and must stay stable",
    );
  });

  it("reports the override as unconfigured when it is absent", () => {
    assertEquals(
      isHostProjectExecutionOverrideConfigured(undefined),
      false,
      "an unset override must be reported as unconfigured",
    );
  });

  it("recognizes accepted affirmative values", () => {
    for (const value of ["1", "true", "yes", "on", " TRUE ", "On"]) {
      assertEquals(
        isHostProjectExecutionOverrideConfigured(value),
        true,
        `"${value}" should identify the deprecated override`,
      );
    }
  });

  it("fails closed for negative, empty, and unrecognized values", () => {
    for (const value of ["", " ", "0", "false", "no", "off", "maybe", "2", "enabled"]) {
      assertEquals(
        isHostProjectExecutionOverrideConfigured(value),
        false,
        `"${value}" must not identify an active override`,
      );
    }
  });

  it("reads the host environment when no value is supplied", async () => {
    // Exercises the default parameter, which production uses. Every other case
    // passes the value explicitly, so without this the getHostEnv path is
    // never executed and the wiring could silently break.
    await withEnv({ [HOST_PROJECT_EXECUTION_OVERRIDE_ENV]: "1" }, () => {
      assertEquals(
        isHostProjectExecutionOverrideConfigured(),
        true,
        "the override must be readable from the host environment",
      );
      return Promise.resolve();
    });

    await withEnv({ [HOST_PROJECT_EXECUTION_OVERRIDE_ENV]: "0" }, () => {
      assertEquals(
        isHostProjectExecutionOverrideConfigured(),
        false,
        "a negative host value must fail closed",
      );
      return Promise.resolve();
    });
  });

  it("uses the host environment rather than project env", async () => {
    // getHostEnv deliberately bypasses the project env overlay, so a project
    // environment variable of the same name cannot configure the host. A
    // competing project scope has to be registered for that to mean anything.
    await withEnv({ [HOST_PROJECT_EXECUTION_OVERRIDE_ENV]: "0" }, () => {
      runWithProjectEnv({ [HOST_PROJECT_EXECUTION_OVERRIDE_ENV]: "1" }, () => {
        assertEquals(
          isHostProjectExecutionOverrideConfigured(),
          false,
          "a project env value must never configure the host-owned override",
        );
      });
      return Promise.resolve();
    });

    await withEnv({ [HOST_PROJECT_EXECUTION_OVERRIDE_ENV]: "1" }, () => {
      runWithProjectEnv({ [HOST_PROJECT_EXECUTION_OVERRIDE_ENV]: "0" }, () => {
        assertEquals(
          isHostProjectExecutionOverrideConfigured(),
          true,
          "the host configuration must remain visible while a project overlay is active",
        );
      });
      return Promise.resolve();
    });
  });
});
