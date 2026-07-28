import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { SSRDependencyValidator } from "./ssr-dependency-validator.ts";

function createValidator(): SSRDependencyValidator {
  return new SSRDependencyValidator(
    () =>
      Promise.resolve({
        tempPath: "/tmp/module.mjs",
        contentHash: "abcdef12",
      }),
    () => Promise.resolve("/tmp/cross-project.mjs"),
    denoAdapter,
    "/project",
  );
}

describe("SSRDependencyValidator", () => {
  it("bounds, deduplicates, and reports accumulated missing dependencies", () => {
    const validator = createValidator();

    for (let index = 0; index < 150; index++) {
      validator.addMissingDependency({
        specifier: `./missing-${index}.ts`,
        fromFile: "/project/Page.tsx",
        reason: `missing ${index}`,
      });
    }
    validator.addMissingDependency({
      specifier: "./missing-0.ts",
      fromFile: "/project/Page.tsx",
      reason: "missing 0",
    });

    assertEquals(validator.missingDependencies.length, 100);
    assertEquals(validator.missingDependencyCount, 150);
    assertThrows(
      () => validator.throwMissingDependencies("/project/Page.tsx"),
      Error,
      "50 additional dependencies omitted",
    );
  });

  it("merges a singleflight leader's structured dependency failure", () => {
    const leader = createValidator();
    const follower = createValidator();
    leader.addMissingDependency({
      specifier: "./missing.ts",
      fromFile: "/project/Page.tsx",
      reason: "not found",
    });

    let leaderError: unknown;
    try {
      leader.throwMissingDependencies("/project/Page.tsx");
    } catch (error) {
      leaderError = error;
    }

    assertEquals(follower.mergeMissingDependencyError(leaderError), true);
    assertEquals(follower.missingDependencyCount, 1);
    assertEquals(follower.missingDependencies[0]?.specifier, "./missing.ts");
    assertEquals(
      follower.mergeMissingDependencyError(new Error("syntax error")),
      false,
    );
  });
});
