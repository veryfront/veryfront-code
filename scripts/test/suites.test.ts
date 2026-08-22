import { assertEquals, assertThrows } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  LEAF_TEST_SUITES,
  resolveLeafSuiteOwners,
  validateLeafSuiteRegistry,
} from "./suites.ts";

describe("leaf test suite registry", () => {
  it("records runtime as one suite with variants, ownership, and support exclusions", () => {
    // Production break caught: node and bun runtime tests can drift into
    // competing leaf owners instead of one runtime suite with runner variants.
    const runtimeSuites = LEAF_TEST_SUITES.filter((suite) =>
      suite.id === "runtime"
    );

    assertEquals(runtimeSuites.length, 1);
    assertEquals(runtimeSuites[0], {
      id: "runtime",
      level: "unit",
      pathSelectors: [],
      runner: "deno",
      prOwner: "test-architecture",
      scheduledOwner: "runtime-compat",
      supportExclusions: ["tests/**/fixtures/**", "tests/**/support/**"],
      runtimeVariants: [
        { id: "node", runner: "node", owner: "runtime-compat" },
        { id: "bun", runner: "bun", owner: "runtime-compat" },
      ],
    });
  });

  it("rejects duplicate canonical owners for one executable test path", () => {
    // Production break caught: overlapping canonical ownership silently lets
    // one file appear in multiple canonical leaf suites.
    assertThrows(
      () =>
        validateLeafSuiteRegistry([
          {
            id: "unit",
            level: "unit",
            pathSelectors: ["src/"],
            runner: "deno",
            prOwner: "test-architecture",
            supportExclusions: [],
          },
          {
            id: "integration",
            level: "integration",
            pathSelectors: ["src/agent/"],
            runner: "deno",
            prOwner: "test-architecture",
            supportExclusions: [],
          },
        ]),
      Error,
      "multiple canonical owners",
    );
  });

  it("resolves canonical unit roots using real path matching", () => {
    // Production break caught: the approved colocated unit roots are recorded
    // in docs but the runtime matcher still treats them as migration paths.
    assertEquals(resolveLeafSuiteOwners("src/agent/factory.test.ts"), [
      { level: "unit", suite: "unit", runner: "deno" },
    ]);
    assertEquals(resolveLeafSuiteOwners("cli/router.test.ts"), [
      { level: "unit", suite: "unit", runner: "deno" },
    ]);
    assertEquals(
      resolveLeafSuiteOwners(
        "extensions/ext-bundler-esbuild/src/binary.test.ts",
      ),
      [{ level: "unit", suite: "unit", runner: "deno" }],
    );
    assertEquals(resolveLeafSuiteOwners("templates/scaffold-parity.test.ts"), [
      { level: "unit", suite: "unit", runner: "deno" },
    ]);
    assertEquals(resolveLeafSuiteOwners("scripts/test/test-layout.test.ts"), [
      { level: "unit", suite: "unit", runner: "deno" },
    ]);
    assertEquals(resolveLeafSuiteOwners("react/react.test.ts"), [
      { level: "unit", suite: "unit", runner: "deno" },
    ]);
  });
});
