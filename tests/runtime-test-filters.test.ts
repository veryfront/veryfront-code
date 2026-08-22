/**
 * The Node and Bun runners must keep the Deno-only tests out, and everything
 * else in.
 *
 * Both halves matter. A filter that excludes too little lets a Deno-only test
 * run on an incompatible runtime. A filter that excludes too much silently
 * shrinks the suite, which nothing else would notice.
 *
 * The list is easy to break by accident: renaming those files, or moving them
 * out of `src/testing/`, leaves a pattern matching nothing and the runner fails
 * again in the next runtime job. Because an over-broad filter can still leave
 * both CI jobs green, this test guards the selected inventory itself.
 *
 * @module tests/runtime-test-filters
 */

import { describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { DENO_ONLY_TESTS } from "./deno-only-tests.mjs";
import { filterTestFiles } from "./test-file-utils.mjs";
import { validateSuitePlan } from "./load-suite-plan.mjs";

/** The files the shared list exists to exclude. */
const DENO_ONLY_FILES = [
  "src/server/dev-server/handler-only.integration.test.ts",
  "src/testing/cwd-exclusion-a.test.ts",
  "src/testing/cwd-exclusion-b.test.ts",
];

/** Ordinary tests, including neighbours of the excluded pair. */
const ELIGIBLE_FILES = [
  "src/testing/cwd.test.ts",
  "src/testing/isolation.test.ts",
  "src/errors/error-registry.test.ts",
  "cli/router.test.ts",
];

describe("runtime test filters", () => {
  it("rejects malformed planner output before a runtime can silently pass", () => {
    assertEquals(
      validateSuitePlan({
        version: 1,
        suite: "runtime:node",
        runner: "node",
        files: ["src/a.test.ts"],
      }, "runtime:node"),
      ["src/a.test.ts"],
    );

    for (
      const invalid of [
        {},
        { version: 1, suite: "runtime:bun", runner: "node", files: [] },
        { version: 1, suite: "runtime:node", runner: "node", files: [1] },
        {
          version: 1,
          suite: "runtime:node",
          runner: "node",
          files: ["../outside.test.ts"],
        },
        {
          version: 1,
          suite: "runtime:node",
          runner: "node",
          files: ["src/z.test.ts", "src/a.test.ts"],
        },
      ]
    ) {
      let rejected = false;
      try {
        validateSuitePlan(invalid, "runtime:node");
      } catch {
        rejected = true;
      }
      assert(rejected, "malformed planner output must be rejected");
    }
  });

  it("excludes the Deno-only tests from non-Deno runners", () => {
    const kept = filterTestFiles(DENO_ONLY_FILES, { exclude: DENO_ONLY_TESTS });

    assertEquals(kept, [], "these cannot run outside Deno");
  });

  it("keeps every other test eligible", () => {
    const kept = filterTestFiles(ELIGIBLE_FILES, { exclude: DENO_ONLY_TESTS });

    // `cwd.test.ts` sits beside the excluded pair and starts with the same
    // three letters, so an over-broad pattern would take it too.
    assertEquals(kept, ELIGIBLE_FILES, "the filter must not shrink the suite");
  });

  it("keeps the portable removal suite scannable by the other runners", async () => {
    // Both runners drop a file whose own source names the Deno namespace with a
    // trailing dot. `fs-remove-portable.test.ts` exists precisely to run on Node
    // and Bun, so that spelling must never appear in it -- not in code, and not
    // in a comment explaining the rule, which is how a first draft excluded
    // itself. Prose may say "Deno"; only "Deno." is disqualifying.
    const source = await Deno.readTextFile(
      new URL("../src/platform/compat/fs-remove-portable.test.ts", import.meta.url),
    );

    assertEquals(
      /\bDeno\./.test(source),
      false,
      "naming the Deno namespace here silently removes this suite from Node and Bun",
    );
  });

  it("matches files that actually exist", async () => {
    // A renamed or moved file leaves a pattern matching nothing, and the
    // exclusion silently stops working. Cheaper to catch here than in a failing
    // `test:node` run.
    for (const path of DENO_ONLY_FILES) {
      const stat = await Deno.stat(new URL(`../${path}`, import.meta.url));
      assert(stat.isFile, `${path} is named in the exclusion list but is missing`);
    }
  });
});
