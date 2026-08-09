/**
 * The Node and Bun runners must keep the Deno-only tests out, and everything
 * else in.
 *
 * Both halves matter. A filter that excludes too little lets
 * the cross-file exclusion probes run on runtimes that do not share Deno's
 * process state model. A filter that excludes too much silently shrinks the
 * suite, which nothing else would notice.
 *
 * The list is easy to break by accident: renaming those files, or moving them
 * out of `src/testing/`, leaves a pattern matching nothing and the runner fails
 * again the next time someone runs `deno task test:node`. Neither task runs in
 * CI, so this is the only thing standing between that and a surprised human.
 *
 * @module tests/runtime-test-filters
 */

import { describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { DENO_ONLY_TESTS } from "./deno-only-tests.mjs";
import { filterTestFiles } from "./test-file-utils.mjs";

/** The files the shared list exists to exclude. */
const DENO_ONLY_FILES = [
  "src/testing/cwd-exclusion-a.test.ts",
  "src/testing/cwd-exclusion-b.test.ts",
  "src/testing/env-exclusion-a.test.ts",
  "src/testing/env-exclusion-b.test.ts",
];

/** Ordinary tests, including neighbours of the excluded pairs. */
const ELIGIBLE_FILES = [
  "src/testing/cwd.test.ts",
  "src/testing/isolation.test.ts",
  "src/errors/error-registry.test.ts",
  "cli/router.test.ts",
];

describe("runtime test filters", () => {
  it("excludes the Deno-only tests from non-Deno runners", () => {
    const kept = filterTestFiles(DENO_ONLY_FILES, { exclude: DENO_ONLY_TESTS });

    assertEquals(kept, [], "these probes only apply to parallel Deno test files");
  });

  it("keeps every other test eligible", () => {
    const kept = filterTestFiles(ELIGIBLE_FILES, { exclude: DENO_ONLY_TESTS });

    // `cwd.test.ts` sits beside the excluded pair and starts with the same
    // three letters, so an over-broad pattern would take it too.
    assertEquals(kept, ELIGIBLE_FILES, "the filter must not shrink the suite");
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
