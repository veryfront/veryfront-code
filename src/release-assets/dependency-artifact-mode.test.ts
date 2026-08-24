import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  DEPENDENCY_ARTIFACT_MODE_ENV,
  DEPENDENCY_ARTIFACT_PROJECTS_ENV,
  DEPENDENCY_ARTIFACT_ROLLOUT_PERCENT_ENV,
  getDependencyArtifactModeForProject,
  parseDependencyArtifactRolloutConfig,
  resolveDependencyArtifactMode,
} from "./dependency-artifact-mode.ts";

const ROLLOUT_ENV_KEYS = [
  DEPENDENCY_ARTIFACT_MODE_ENV,
  DEPENDENCY_ARTIFACT_ROLLOUT_PERCENT_ENV,
  DEPENDENCY_ARTIFACT_PROJECTS_ENV,
] as const;

function restoreEnv(values: ReadonlyMap<string, string | undefined>): void {
  for (const key of ROLLOUT_ENV_KEYS) {
    const value = values.get(key);
    if (value === undefined) deleteEnv(key);
    else setEnv(key, value);
  }
}

describe("dependency artifact rollout mode", () => {
  it("defaults to off when rollout configuration is absent or invalid", () => {
    assertEquals(parseDependencyArtifactRolloutConfig({}), {
      mode: "off",
      rolloutBasisPoints: 0,
      projectAllowlist: [],
    });
    assertEquals(parseDependencyArtifactRolloutConfig({ mode: "enabled" }), {
      mode: "off",
      rolloutBasisPoints: 0,
      projectAllowlist: [],
    });
  });

  it("keeps the host-configured interface off when no rollout env is set", () => {
    const original = new Map(ROLLOUT_ENV_KEYS.map((key) => [key, getHostEnv(key)]));
    try {
      for (const key of ROLLOUT_ENV_KEYS) deleteEnv(key);
      assertEquals(getDependencyArtifactModeForProject("project-alpha"), "off");
    } finally {
      restoreEnv(original);
    }
  });

  it("activates the configured mode for allowlisted projects from host env", () => {
    const original = new Map(ROLLOUT_ENV_KEYS.map((key) => [key, getHostEnv(key)]));
    try {
      // Percent 0 plus an allowlist pins each env key to its own field: a
      // swapped key leaves the project outside both the mode and the cohort.
      setEnv(DEPENDENCY_ARTIFACT_MODE_ENV, "prefer");
      setEnv(DEPENDENCY_ARTIFACT_ROLLOUT_PERCENT_ENV, "0");
      setEnv(DEPENDENCY_ARTIFACT_PROJECTS_ENV, "project-alpha");

      assertEquals(
        getDependencyArtifactModeForProject("project-alpha"),
        "prefer",
        "an allowlisted project must pick up the host-configured mode",
      );
      assertEquals(
        getDependencyArtifactModeForProject("project-gamma"),
        "off",
        "a project outside the allowlist and cohort stays off",
      );
    } finally {
      restoreEnv(original);
    }
  });

  it("accepts only the four rollout modes", () => {
    for (const mode of ["off", "shadow", "prefer", "require"] as const) {
      assertEquals(
        parseDependencyArtifactRolloutConfig({ mode, rolloutPercent: "100" }).mode,
        mode,
      );
    }
  });

  it("keeps off authoritative over percentage and allowlist selection", () => {
    const config = parseDependencyArtifactRolloutConfig({
      mode: "off",
      rolloutPercent: "100",
      projectAllowlist: "project-alpha",
    });

    assertEquals(resolveDependencyArtifactMode("project-alpha", config), "off");
  });

  it("selects explicit projects and deduplicates allowlist entries", () => {
    const config = parseDependencyArtifactRolloutConfig({
      mode: "shadow",
      rolloutPercent: "0",
      projectAllowlist: " project-alpha,project-beta,project-alpha ",
    });

    assertEquals(config.projectAllowlist, ["project-alpha", "project-beta"]);
    assertEquals(resolveDependencyArtifactMode("project-alpha", config), "shadow");
    assertEquals(resolveDependencyArtifactMode("project-gamma", config), "off");
  });

  it("supports hundredth-percent cohorts with strict bounds", () => {
    const selected = parseDependencyArtifactRolloutConfig({
      mode: "prefer",
      rolloutPercent: "45.04",
    });
    const notSelected = parseDependencyArtifactRolloutConfig({
      mode: "prefer",
      rolloutPercent: "45.03",
    });

    assertEquals(selected.rolloutBasisPoints, 4504);
    assertEquals(resolveDependencyArtifactMode("project-alpha", selected), "prefer");
    assertEquals(resolveDependencyArtifactMode("project-alpha", selected), "prefer");
    assertEquals(resolveDependencyArtifactMode("project-alpha", notSelected), "off");

    for (const rolloutPercent of ["-1", "100.01", "1.234", "1e2", "NaN"]) {
      assertEquals(
        parseDependencyArtifactRolloutConfig({ mode: "require", rolloutPercent })
          .rolloutBasisPoints,
        0,
      );
    }
  });

  it("never selects a request without a project identity", () => {
    const config = parseDependencyArtifactRolloutConfig({
      mode: "require",
      rolloutPercent: "100",
    });

    assertEquals(resolveDependencyArtifactMode(undefined, config), "off");
    assertEquals(resolveDependencyArtifactMode(null, config), "off");
    assertEquals(resolveDependencyArtifactMode("", config), "off");
  });
});
