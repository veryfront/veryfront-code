import { assertEquals, assertThrows } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  LEAF_TEST_SUITES,
  resolveLeafSuiteOwners,
  validateLeafSuiteRegistry,
} from "./suites.ts";

describe("leaf test suite registry", () => {
  it("records runtime as a variant of one canonical runtime suite", () => {
    // Production break caught: node and bun runtime tests can drift into
    // competing owners instead of one runtime leaf with runner variants.
    const runtimeSuites = LEAF_TEST_SUITES.filter((suite) =>
      suite.id === "runtime"
    );

    assertEquals(runtimeSuites.length, 2);
    assertEquals(
      runtimeSuites.map((suite) => suite.variant).sort(),
      ["bun", "node"],
    );
    assertEquals(
      new Set(runtimeSuites.map((suite) => suite.id)).size,
      1,
    );
  });

  it("rejects duplicate canonical owners for one executable test path", () => {
    // Production break caught: overlapping canonical ownership silently lets
    // one file run in multiple suites.
    assertThrows(
      () =>
        validateLeafSuiteRegistry([
          {
            id: "unit",
            level: "unit",
            pathPrefix: "src/",
            runner: "deno",
          },
          {
            id: "integration",
            level: "integration",
            pathPrefix: "src/agent/",
            runner: "deno",
          },
        ]),
      Error,
      "multiple canonical owners",
    );
  });

  it("resolves the canonical owner using real path matching", () => {
    // Production break caught: tests that grep registry source can pass while
    // the path matcher returns the wrong owner at runtime.
    const owners = resolveLeafSuiteOwners(
      "tests/bun/workspace-resolution.test.ts",
      LEAF_TEST_SUITES,
    );

    assertEquals(owners, [
      {
        level: "runtime",
        suite: "runtime",
        variant: "bun",
        runner: "bun",
      },
    ]);
  });
});
