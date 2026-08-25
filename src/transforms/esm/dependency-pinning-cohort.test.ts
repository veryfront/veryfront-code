import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type DependencyPinningCohortConfig,
  parseDependencyPinningCohortConfig,
  resolveDependencyPinningCohort,
} from "./dependency-pinning-cohort.ts";

const OFF: DependencyPinningCohortConfig = {
  rolloutBasisPoints: 0,
  projectAllowlist: [],
};

describe("parseDependencyPinningCohortConfig", () => {
  it("should default an absent percent to zero", () => {
    assertEquals(parseDependencyPinningCohortConfig({}), OFF);
  });

  it("should reject a malformed percent rather than widening the rollout", () => {
    assertEquals(
      parseDependencyPinningCohortConfig({ rolloutPercent: "fifty" }).rolloutBasisPoints,
      0,
    );
    assertEquals(
      parseDependencyPinningCohortConfig({ rolloutPercent: "101" }).rolloutBasisPoints,
      0,
    );
    assertEquals(
      parseDependencyPinningCohortConfig({ rolloutPercent: "-5" }).rolloutBasisPoints,
      0,
    );
  });

  it("should convert percentages to basis points", () => {
    assertEquals(
      parseDependencyPinningCohortConfig({ rolloutPercent: "100" }).rolloutBasisPoints,
      10_000,
    );
    assertEquals(
      parseDependencyPinningCohortConfig({ rolloutPercent: "1" }).rolloutBasisPoints,
      100,
    );
    assertEquals(
      parseDependencyPinningCohortConfig({ rolloutPercent: "0.25" }).rolloutBasisPoints,
      25,
    );
  });

  it("should parse and de-duplicate the project allowlist", () => {
    assertEquals(
      parseDependencyPinningCohortConfig({
        projectAllowlist: " a , b ,a, ",
      }).projectAllowlist,
      ["a", "b"],
    );
  });
});

describe("resolveDependencyPinningCohort", () => {
  it("should be disabled when the rollout is off", () => {
    assertEquals(resolveDependencyPinningCohort("project-1", OFF), false);
  });

  it("should be universal at one hundred percent even without a project id", () => {
    const config = parseDependencyPinningCohortConfig({ rolloutPercent: "100" });
    assertEquals(resolveDependencyPinningCohort("project-1", config), true);
    assertEquals(resolveDependencyPinningCohort(undefined, config), true);
    assertEquals(resolveDependencyPinningCohort(null, config), true);
  });

  it("should fail closed on missing project identity during a partial rollout", () => {
    const config = parseDependencyPinningCohortConfig({ rolloutPercent: "50" });
    assertEquals(resolveDependencyPinningCohort(undefined, config), false);
    assertEquals(resolveDependencyPinningCohort(null, config), false);
    assertEquals(resolveDependencyPinningCohort("", config), false);
  });

  it("should admit an explicitly allowlisted project at zero percent", () => {
    const config = parseDependencyPinningCohortConfig({
      rolloutPercent: "0",
      projectAllowlist: "internal-1",
    });
    assertEquals(resolveDependencyPinningCohort("internal-1", config), true);
    assertEquals(resolveDependencyPinningCohort("internal-2", config), false);
  });

  it("should assign a stable bucket to the same project", () => {
    const config = parseDependencyPinningCohortConfig({ rolloutPercent: "50" });
    const first = resolveDependencyPinningCohort("stable-project", config);
    assertEquals(resolveDependencyPinningCohort("stable-project", config), first);
    assertEquals(resolveDependencyPinningCohort("stable-project", config), first);
  });

  it("should widen monotonically as the percentage grows", () => {
    // A project admitted at 10% must still be admitted at 50%.
    const at10 = parseDependencyPinningCohortConfig({ rolloutPercent: "10" });
    const at50 = parseDependencyPinningCohortConfig({ rolloutPercent: "50" });
    for (let index = 0; index < 200; index++) {
      const projectId = `project-${index}`;
      if (resolveDependencyPinningCohort(projectId, at10)) {
        assertEquals(resolveDependencyPinningCohort(projectId, at50), true);
      }
    }
  });

  it("should spread projects across the bucket space", () => {
    // Guards against a degenerate hash that puts every project in one bucket,
    // which would make a partial rollout silently all-or-nothing.
    const config = parseDependencyPinningCohortConfig({ rolloutPercent: "50" });
    let admitted = 0;
    for (let index = 0; index < 400; index++) {
      if (resolveDependencyPinningCohort(`spread-${index}`, config)) admitted++;
    }
    assertEquals(admitted > 100 && admitted < 300, true);
  });
});
