import { assert, assertEquals, assertStringIncludes } from "#std/assert";

/**
 * Repo files are resolved from this module's own location, never from
 * `Deno.cwd()`, and are read inside each test rather than at module scope.
 *
 * Both parts matter, and both were learned the hard way:
 *
 * 1. NOT CWD-RELATIVE. Test files are separate isolates sharing ONE process
 *    under `--parallel`, and `src/testing/cwd.ts` calls `Deno.chdir` on that
 *    shared process (see its own header: "mutates state shared by every test in
 *    the process"). It restores in a `finally`, but that only closes the window
 *    afterwards — a concurrent reader inside the window still resolves against
 *    the wrong directory. Which files share a process is decided by
 *    `selectShardFiles` (`index % 8` over the sorted file list), so adding any
 *    test file anywhere reshuffles the pairing. This module was the only test in
 *    the repo reading repo files by cwd-relative path, and it failed in CI with
 *    `NotFound: readfile '.github/workflows/cicd.yml'` the moment a shard
 *    reshuffle put it beside a chdir. Resolving through `import.meta.url`
 *    removes the dependency instead of trying to coordinate with other tests.
 *
 * 2. NOT AT MODULE SCOPE. A top-level `await` that throws is an *uncaught*
 *    module error: Deno fails the whole file, the shard fails, and because
 *    `tests (unit)` and `coverage gate` both depend on the shard job, one
 *    missing file surfaced as THREE red checks with no useful message. Read
 *    inside the test and the same failure is one legible failing test.
 */
const repoRoot = new URL("../../", import.meta.url);

const readRepoFile = (path: string): Promise<string> => Deno.readTextFile(new URL(path, repoRoot));

const readWorkflow = () => readRepoFile(".github/workflows/cicd.yml");

/**
 * Asserts the task exists rather than casting the lookup. A renamed or deleted
 * task is exactly what this test guards, so it should report that by name
 * instead of failing on an `undefined` comparison.
 */
const readDenoTask = async (name: string): Promise<string> => {
  const denoJson = JSON.parse(await readRepoFile("deno.json")) as {
    tasks?: Record<string, string | undefined>;
  };
  const task = denoJson.tasks?.[name];
  assert(
    typeof task === "string",
    `deno.json defines no "${name}" task`,
  );
  return task;
};

Deno.test("CI shards Deno unit coverage as portable lcov artifacts", async () => {
  const workflow = await readWorkflow();

  assertStringIncludes(workflow, "coverage-shards:");
  assertStringIncludes(workflow, "name: coverage shard ${{ matrix.shard }}/8");
  assertStringIncludes(workflow, "timeout-minutes: 5");
  assertStringIncludes(workflow, "shard: [1, 2, 3, 4, 5, 6, 7, 8]");
  assertStringIncludes(
    workflow,
    "deno task coverage:ci:shard -- --shard=${{ matrix.shard }}/8 --coverage-dir=coverage-shard-${{ matrix.shard }}",
  );
  assertStringIncludes(workflow, "actions/upload-artifact");
  assertStringIncludes(workflow, "name: coverage-shard-${{ matrix.shard }}");
  assertStringIncludes(
    workflow,
    "path: coverage-shard-${{ matrix.shard }}/lcov.info",
  );
});

Deno.test("CI keeps the required coverage gate as a fast merge job", async () => {
  const workflow = await readWorkflow();

  assertStringIncludes(workflow, "coverage:");
  assertStringIncludes(workflow, "name: coverage gate");
  assertStringIncludes(workflow, "needs: [coverage-shards]");
  assertStringIncludes(
    workflow,
    "if: ${{ always() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) }}",
  );
  assertStringIncludes(workflow, "timeout-minutes: 5");
  assertStringIncludes(workflow, "actions/download-artifact");
  assertStringIncludes(workflow, "Download unit coverage lcov files");
  assertStringIncludes(workflow, "pattern: coverage-shard-*");
  assertStringIncludes(
    workflow,
    "deno task coverage:ci:merge coverage-profiles/coverage-shard-*",
  );
  assert(!workflow.includes("timeout_minutes: 22"));
  assert(
    !workflow.includes(
      "command: VF_DISABLE_LRU_INTERVAL=1 deno task coverage:ci",
    ),
  );
});

Deno.test("deno tasks expose shard and merge coverage entrypoints", async () => {
  assertEquals(
    await readDenoTask("coverage:ci:shard"),
    "deno run --allow-read --allow-write --allow-run --allow-env scripts/test/coverage-ci.ts shard",
  );
  assertEquals(
    await readDenoTask("coverage:ci:merge"),
    "deno run --no-npm --allow-read --allow-write --allow-run --allow-env scripts/test/coverage-ci.ts merge",
  );
});

Deno.test("coverage gates require the ratcheted 80 percent floor", async () => {
  const coverageCiScript = await readRepoFile("scripts/test/coverage-ci.ts");

  assertStringIncludes(
    await readDenoTask("coverage:gate"),
    "scripts/lint/check-coverage.ts 80",
  );
  assertStringIncludes(
    await readDenoTask("coverage:report"),
    "scripts/lint/check-coverage.ts 80",
  );
  assertStringIncludes(
    coverageCiScript,
    'readOption(args, "--threshold") ?? "80"',
  );
});
