import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readTextFile } from "#veryfront/platform/compat/fs.ts";
import { fromFileUrl } from "#veryfront/platform/compat/path/index.ts";

/**
 * Repo files are resolved from this module's own location, never from the
 * process cwd, and are read inside each test rather than at module scope.
 *
 * Both parts matter, and both were learned the hard way:
 *
 * 1. NOT CWD-RELATIVE. Test files are separate isolates sharing ONE process
 *    under `--parallel`, and `src/testing/cwd.ts` chdirs that shared process
 *    (see its own header: "mutates state shared by every test in the process").
 *    It restores in a `finally`, but that only closes the window afterwards — a
 *    concurrent reader inside the window still resolves against the wrong
 *    directory. Which files share a process is decided by `selectShardFiles`
 *    (`index % 8` over the sorted file list), so adding any test file anywhere
 *    reshuffles the pairing. This module read repo files by cwd-relative path
 *    and failed in CI with `NotFound: readfile '.github/workflows/cicd.yml'`
 *    the moment a shard reshuffle put it beside a chdir. Resolving through
 *    `import.meta.url` removes the dependency instead of trying to coordinate
 *    with other tests.
 *
 * 2. NOT AT MODULE SCOPE. A top-level `await` that throws is an *uncaught*
 *    module error: the runner fails the whole file, the shard fails, and
 *    because `tests (unit)` and `coverage gate` both depend on the shard job,
 *    one missing file surfaced as THREE red checks with no useful message.
 *    Read inside the test and the same failure is one legible failing test.
 *
 * The reads go through `#veryfront/platform/compat/fs.ts` rather than the
 * runtime global so this file keeps running on all three runtimes — see the
 * guard at the bottom.
 */
const repoRoot = new URL("../../", import.meta.url);

const readRepoFile = (path: string): Promise<string> =>
  readTextFile(fromFileUrl(new URL(path, repoRoot)));

const readWorkflow = () => readRepoFile(".github/workflows/cicd.yml");

/**
 * Asserts the task exists rather than casting the lookup. A renamed or deleted
 * task is exactly what this test guards, so it should report that by name
 * instead of failing on an `undefined` comparison.
 */
const readDenoTask = async (name: string): Promise<string> => {
  const config = JSON.parse(await readRepoFile("deno.json")) as {
    tasks?: Record<string, string | undefined>;
  };
  const task = config.tasks?.[name];
  assert(
    typeof task === "string",
    `deno.json defines no "${name}" task`,
  );
  return task;
};

describe("cicd coverage workflow", () => {
  it("shards unit coverage as portable lcov artifacts", async () => {
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

  it("keeps the required coverage gate as a fast merge job", async () => {
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

  it("exposes shard and merge coverage entrypoints as tasks", async () => {
    assertEquals(
      await readDenoTask("coverage:ci:shard"),
      "deno run --allow-read --allow-write --allow-run --allow-env scripts/test/coverage-ci.ts shard",
    );
    assertEquals(
      await readDenoTask("coverage:ci:merge"),
      "deno run --no-npm --allow-read --allow-write --allow-run --allow-env scripts/test/coverage-ci.ts merge",
    );
  });

  it("gates coverage on the ratcheted 80 percent floor", async () => {
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

  it("blocks live provider egress in every Deno unit coverage path", async () => {
    const providerDenyNet =
      "--deny-net=api.openai.com,api.anthropic.com,generativelanguage.googleapis.com,api.mistral.ai,api.groq.com,api.deepseek.com,openrouter.ai";
    const coverageCiScript = await readRepoFile("scripts/test/coverage-ci.ts");

    assertStringIncludes(coverageCiScript, `"${providerDenyNet}"`);
    for (
      const taskName of [
        "test:coverage",
        "test:coverage:unit",
        "test:coverage:integration",
      ]
    ) {
      assertStringIncludes(await readDenoTask(taskName), providerDenyNet);
    }
  });

  it("stays runnable on every runtime, not just the one with the global", async () => {
    // `tests/node/run-tests.mjs` drops any file under src/ whose source mentions
    // the runtime global, and `tests/bun/run-tests.mjs` shares that list. This
    // file used the global for both its test registration and its reads, so
    // every assertion above ran on exactly one of the three runtimes and the
    // other two reported a silent pass. Assert the property the runner filters
    // on, so the gap cannot reopen unnoticed.
    //
    // The needle is spelled in parts because a literal occurrence here would
    // itself trip the filter this test exists to satisfy.
    const runtimeGlobal = ["De", "no", "."].join("");
    const source = await readRepoFile("src/config/cicd-coverage-workflow.test.ts");

    assert(
      !source.includes(runtimeGlobal),
      `This test must not use the ${runtimeGlobal}* global — it would be excluded ` +
        `from the Node and Bun runners, leaving its assertions unverified there.`,
    );
  });
});
