/**
 * Test files that only make sense under `deno test`, shared by the Node and Bun
 * runners.
 *
 * Both runners already drop a file whose own source mentions `Deno.`, which
 * covers almost everything. It does not cover a file whose Deno usage lives in
 * a helper it imports -- the heuristic reads one file, not the module graph --
 * and it says nothing about files that are Deno-only by *subject* rather than
 * by which API they happen to call.
 *
 * The working-directory pair below is both. It asserts a property of
 * `deno test --parallel` itself: that test files sharing one process do not
 * share a working directory. Node and Bun give each file its own process, so
 * there is no property there to assert even if the APIs existed. The dev-server
 * integration imports Deno-only extension discovery through its module graph,
 * which the source-file heuristic cannot see.
 *
 * Kept here rather than duplicated in each runner so the two cannot drift, and
 * so it can be tested -- see ./runtime-test-filters.test.ts.
 *
 * @module tests/deno-only-tests
 */

/** Glob patterns for tests that must not run outside Deno. */
export const DENO_ONLY_TESTS = [
  "src/server/dev-server/handler-only.integration.test.ts",
  "src/testing/cwd-exclusion-*.test.ts",
];
